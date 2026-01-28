import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dayjs from 'dayjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectToDatabase, closeDatabase, toObjectId } from './config/database.js';
import fs from 'fs';
import CarbonCalculator from './services/carbonCalculator.js';
import CarbonTracking from './models/carbonTracking.js';
import donationRoutes from "./routes/donationRoutes.js";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use("/api/donations", donationRoutes);

let db = null;

// Initialize carbon calculator and tracking
const carbonCalculator = new CarbonCalculator();
const carbonTracking = new CarbonTracking();

// SSE clients
const sseClients = new Set();
function broadcast(event, data) {
	const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	for (const res of sseClients) {
		try { res.write(payload); } catch { }
	}
}

function parseQuantity(quantityStr) {
	if (!quantityStr) return 0;
	const match = quantityStr.match(/(\d+(?:\.\d+)?)/);
	return match ? parseFloat(match[1]) : 0;
}

function calculateRemainingQuantity(listing, pickups) {
	const totalQuantity = parseQuantity(listing.quantity);
	const claimedQuantity = pickups.reduce((sum, pickup) => {
		return sum + parseQuantity(pickup.quantity || listing.quantity);
	}, 0);
	return Math.max(0, totalQuantity - claimedQuantity);
}

/*async function expireStaleListings() {
	if (!db) return;
	try {
		const now = Date.now();
		const result = await db.collection('listings').updateMany(
			{ status: 'active', expires_at: { $lte: now } },
			{ $set: { status: 'expired' } }
		);
		if (result.modifiedCount > 0) {
			const expired = await db.collection('listings').find({
				status: 'expired',
				expires_at: { $lte: now },
				created_at: { $gte: now - 24*3600*1000 }
			}).toArray();
			broadcast('expired', expired);
		}
	} catch (error) {
		console.error('Error expiring stale listings:', error);
	}
}*/

async function promptForEndedEvents() {
	if (!db) return;
	try {
		const now = Date.now();
		const twoHoursAgo = now - 2 * 3600 * 1000;
		const eventsToPrompt = await db.collection('events').find({
			prompted_at: { $in: [null, undefined] },
			ends_at: { $lte: now, $gte: twoHoursAgo }
		}).toArray();
		if (eventsToPrompt.length > 0) {
			for (const ev of eventsToPrompt) {
				await db.collection('events').updateOne({ _id: ev._id }, { $set: { prompted_at: now } });
				broadcast('event_prompt', ev);
			}
		}
	} catch (error) {
		console.error('Error prompting for ended events:', error);
	}
}

// Routes
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// API Config endpoint
app.get('/api/config', (_req, res) => {
	res.json({
		// No API keys needed for OpenStreetMap
		config_version: '1.0.0'
	});
});

// SSE stream endpoint
app.get('/api/stream', (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders?.();
	sseClients.add(res);
	res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
	req.on('close', () => sseClients.delete(res));
});

// List listings - supports filtering by status and ownerEmail
/*app.get('/api/listings', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const { status, ownerEmail } = req.query;
		const query = {};
		if (status) query.status = status;
		if (ownerEmail) query.owner_email = ownerEmail;
		const rows = await db.collection('listings').find(query).sort({ created_at: -1 }).toArray();
		const listingsWithRemaining = await Promise.all(rows.map(async (listing) => {
			const listingPickups = await db.collection('pickups').find({ listing_id: listing._id.toString() }).toArray();
			const remainingQuantity = calculateRemainingQuantity(listing, listingPickups);
			return { ...listing, remaining_quantity: remainingQuantity, is_fully_claimed: remainingQuantity <= 0 };
		}));
		res.json(listingsWithRemaining);
	} catch (error) {
		console.error('Error fetching listings:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Create listing - attach owner_email and owner_name from header or body
app.post('/api/listings', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const ownerEmail = (req.headers['x-user-email'] || req.body?.ownerEmail || '').toString().trim();
		const ownerName = (req.headers['x-user-name'] || req.body?.ownerName || '').toString().trim();
		const { 
			title, type, quantity, location, freshnessHours, notes, contact,
			house_number, street_number, landmark, map_coordinates, provider_name
		} = req.body || {};
		
		// Debug logging for provider_name
		console.log('Creating listing with provider_name:', {
			provider_name,
			ownerName,
			body: req.body
		});
		if (!title || !type || !quantity || !location || !freshnessHours) {
			return res.status(400).json({ error: 'Missing required fields' });
		}
		const now = Date.now();
		const expiresAt = now + (Number(freshnessHours) * 60 * 60 * 1000); // Convert hours to milliseconds

		const toInsert = {
			title,
			type,
			quantity,
			house_number: house_number || null,
			street_number: street_number || null,
			landmark: landmark || null,
			area: location,
			map_coordinates: map_coordinates || null, // Store map coordinates if provided
			freshness_hours: Number(freshnessHours),
			notes: notes || null,
			contact: contact || null,
			provider_name: provider_name || null, // Store provider name from form
			created_at: now,
			expires_at: expiresAt,
			status: 'active',
			owner_email: ownerEmail || null,
			owner_name: ownerName || null
		};
		const result = await db.collection('listings').insertOne(toInsert);
		const row = { ...toInsert, _id: result.insertedId };
		
		// Automatically calculate carbon credits for the food provided
		if (ownerEmail && quantity) {
			try {
				const foodWasteKg = parseQuantity(quantity);
				const foodType = type.toLowerCase().includes('meat') ? 'meat' : 
							   type.toLowerCase().includes('dairy') ? 'dairy' : 
							   type.toLowerCase().includes('grain') ? 'grains' : 
							   type.toLowerCase().includes('vegetable') ? 'vegetables' : 
							   type.toLowerCase().includes('fruit') ? 'fruits' : 'mixed';
				
				const carbonResult = await carbonCalculator.calculateFoodWasteEmissions({
					foodWasteKg,
					foodType,
					location: 'US'
				});
				
				if (carbonResult.success) {
					console.log('Carbon calculation successful for listing:', {
						foodWasteKg,
						foodType,
						carbonCredits: carbonResult.data.carbonCredits,
						emissions: carbonResult.data.emissions
					});
					
					// Track the carbon impact automatically
					await carbonTracking.createRecord({
						listing_id: result.insertedId.toString(),
						user_email: ownerEmail,
						user_name: provider_name || ownerName, // Use provider_name if available, fallback to ownerName
						food_waste_kg: foodWasteKg,
						food_type: foodType,
						transport_method: null,
						distance_km: null,
						emissions: {
							food_waste: carbonResult.data.emissions.foodWaste,
							transportation: carbonResult.data.emissions.transportation,
							total: carbonResult.data.emissions.total
						},
						carbon_credits: {
							generated: carbonResult.data.carbonCredits.generated,
							avoided: carbonResult.data.carbonCredits.avoided,
							net: carbonResult.data.carbonCredits.net
						},
						environmental_impact: carbonResult.data.environmentalImpact,
						carbon_credit_value: carbonCalculator.calculateCarbonCreditValue(
							carbonResult.data.carbonCredits.net,
							'average'
						)
					});
				}
			} catch (carbonError) {
				console.error('Error calculating carbon credits for listing:', carbonError);
				// Don't fail the listing creation if carbon calculation fails
			}
		}
		
		broadcast('new', row);
		res.status(201).json(row);
	} catch (error) {
		console.error('Error creating listing:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Create pickup (unchanged ownership semantics)
app.post('/api/listings/:id/pickups', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const id = req.params.id;
		const objectId = toObjectId(id);
		if (!objectId) return res.status(400).json({ error: 'Invalid listing ID' });
		const listing = await db.collection('listings').findOne({ _id: objectId });
		if (!listing) return res.status(404).json({ error: 'Listing not found' });
		if (listing.status !== 'active') return res.status(400).json({ error: 'Listing not active' });
		const { claimer, quantity } = req.body || {};
		if (!claimer) return res.status(400).json({ error: 'Missing claimer' });
		const existingPickups = await db.collection('pickups').find({ listing_id: id }).toArray();
		const remainingQuantity = calculateRemainingQuantity(listing, existingPickups);
		const requestedQuantity = parseQuantity(quantity || listing.quantity);
		if (requestedQuantity > remainingQuantity) {
			return res.status(400).json({ error: `Only ${remainingQuantity} units remaining. Cannot claim ${requestedQuantity} units.` });
		}
		const newPickup = { listing_id: id, claimer, quantity: quantity || null, created_at: Date.now() };
		const result = await db.collection('pickups').insertOne(newPickup);
		const insertedPickup = { ...newPickup, _id: result.insertedId };
		const newRemainingQuantity = calculateRemainingQuantity(listing, [...existingPickups, insertedPickup]);
		broadcast('pickup', { listingId: id, pickup: insertedPickup, remainingQuantity: newRemainingQuantity, listing });
		if (newRemainingQuantity <= 0) {
			await db.collection('listings').updateOne({ _id: objectId }, { $set: { status: 'completed' } });
			broadcast('completed', { ...listing, status: 'completed', remaining_quantity: 0, is_fully_claimed: true });
		}
		res.status(201).json({ ...insertedPickup, remainingQuantity: newRemainingQuantity, isFullyClaimed: newRemainingQuantity <= 0 });
	} catch (error) {
		console.error('Error creating pickup:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Complete a listing - only owner can complete
app.post('/api/listings/:id/complete', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const id = req.params.id;
		const objectId = toObjectId(id);
		if (!objectId) return res.status(400).json({ error: 'Invalid listing ID' });
		const requesterEmail = (req.headers['x-user-email'] || req.body?.ownerEmail || '').toString().trim();
		const listing = await db.collection('listings').findOne({ _id: objectId });
		if (!listing) return res.status(404).json({ error: 'Listing not found' });
		if (listing.status !== 'active') return res.status(400).json({ error: 'Listing not active' });
		if (listing.owner_email && requesterEmail && listing.owner_email !== requesterEmail) {
			return res.status(403).json({ error: 'Not authorized to complete this listing' });
		}
		const result = await db.collection('listings').updateOne({ _id: objectId, status: 'active' }, { $set: { status: 'completed' } });
		if (result.modifiedCount === 0) return res.status(400).json({ error: 'Not updated' });
		const row = await db.collection('listings').findOne({ _id: objectId });
		broadcast('completed', row);
		res.json(row);
	} catch (error) {
		console.error('Error completing listing:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.delete('/api/listings/:id', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const id = req.params.id;
		const objectId = toObjectId(id);
		if (!objectId) return res.status(400).json({ error: 'Invalid listing ID' });
		const result = await db.collection('listings').deleteOne({ _id: objectId });
		if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
		broadcast('deleted', { id });
		res.status(204).end();
	} catch (error) {
		console.error('Error deleting listing:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});*/

app.get('/api/analytics', async (_req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const now = Date.now();
		const dayAgo = now - 24 * 3600 * 1000;
		const weekAgo = now - 7 * 24 * 3600 * 1000;
		const [totalListings, activeListings, completedListings, expiredListings, pickupsCount, lastDayListings, lastWeekListings] = await Promise.all([
			db.collection('listings').countDocuments({}),
			db.collection('listings').countDocuments({ status: 'active' }),
			db.collection('listings').countDocuments({ status: 'completed' }),
			db.collection('listings').countDocuments({ status: 'expired' }),
			db.collection('pickups').countDocuments({}),
			db.collection('listings').countDocuments({ created_at: { $gte: dayAgo } }),
			db.collection('listings').countDocuments({ created_at: { $gte: weekAgo } }),
		]);

		// Calculate carbon credits from all listings
		const carbonRecords = await db.collection('carbon_tracking').find({}).toArray();
		console.log('Carbon records found:', carbonRecords.length);
		if (carbonRecords.length > 0) {
			console.log('Sample carbon record:', JSON.stringify(carbonRecords[0], null, 2));
		}
		const totalCarbonCredits = carbonRecords.reduce((sum, record) => sum + (record.carbon_credits?.net || 0), 0);
		const totalCarbonValue = carbonRecords.reduce((sum, record) => sum + (record.carbon_credit_value?.netValue || 0), 0);
		console.log('Total carbon credits:', totalCarbonCredits, 'Total value:', totalCarbonValue);

		const assumedKgPerListing = 5;
		const kgSaved = completedListings * assumedKgPerListing;
		const carbonKgAvoided = kgSaved * 2.5;
		const waterLitersSaved = kgSaved * 1500;

		res.json({
			totals: { totalListings, activeListings, completedListings, expiredListings, pickupsCount },
			recent: { lastDayListings, lastWeekListings },
			impact: { kgSaved, carbonKgAvoided, waterLitersSaved, assumedKgPerListing },
			carbonCredits: {
				totalCredits: totalCarbonCredits,
				totalValue: totalCarbonValue,
				recordsCount: carbonRecords.length
			}
		});
	} catch (error) {
		console.error('Error fetching analytics:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.get('/api/events', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const { scope } = req.query;
		const now = Date.now();
		let rows = [];
		if (scope === 'upcoming') {
			rows = await db.collection('events').find({ ends_at: { $gte: now } }).sort({ starts_at: 1 }).toArray();
		} else if (scope === 'recent') {
			rows = await db.collection('events').find({ ends_at: { $lt: now } }).sort({ ends_at: -1 }).limit(20).toArray();
		} else {
			rows = await db.collection('events').find({}).sort({ starts_at: -1 }).toArray();
		}
		res.json(rows);
	} catch (error) {
		console.error('Error fetching events:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Review system endpoints
app.post('/api/reviews', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const { listing_id, reviewer, rating, comment } = req.body || {};
		if (!listing_id || !reviewer || !rating) {
			return res.status(400).json({ error: 'Missing required fields' });
		}
		if (rating < 1 || rating > 5) {
			return res.status(400).json({ error: 'Rating must be between 1 and 5' });
		}

		// Check if the listing exists
		const objectId = toObjectId(listing_id);
		if (!objectId) return res.status(400).json({ error: 'Invalid listing ID' });
		const listing = await db.collection('listings').findOne({ _id: objectId });
		if (!listing) return res.status(404).json({ error: 'Listing not found' });

		// Check if the user has claimed this listing
		const pickup = await db.collection('pickups').findOne({ listing_id, claimer: reviewer });
		if (!pickup) return res.status(403).json({ error: 'You can only review listings you have claimed' });

		// Check if the user has already reviewed this listing
		const existingReview = await db.collection('reviews').findOne({ listing_id, reviewer });
		if (existingReview) return res.status(400).json({ error: 'You have already reviewed this listing' });

		const review = {
			listing_id,
			reviewer,
			rating,
			comment: comment || null,
			created_at: Date.now()
		};

		const result = await db.collection('reviews').insertOne(review);
		const insertedReview = { ...review, _id: result.insertedId };

		broadcast('review', insertedReview);
		res.status(201).json(insertedReview);
	} catch (error) {
		console.error('Error creating review:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.get('/api/reviews/:listing_id', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const listing_id = req.params.listing_id;
		const reviews = await db.collection('reviews').find({ listing_id }).sort({ created_at: -1 }).toArray();
		res.json(reviews);
	} catch (error) {
		console.error('Error fetching reviews:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Messaging system endpoints
app.post('/api/messages', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const { listing_id, sender, recipient, content } = req.body || {};
		if (!listing_id || !sender || !recipient || !content) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// Check if the listing exists
		const objectId = toObjectId(listing_id);
		if (!objectId) return res.status(400).json({ error: 'Invalid listing ID' });
		const listing = await db.collection('listings').findOne({ _id: objectId });
		if (!listing) return res.status(404).json({ error: 'Listing not found' });

		// Anyone can send messages now
		const isProvider = listing.contact && listing.contact.includes(sender);

		const message = {
			listing_id,
			sender,
			recipient,
			content,
			read: false,
			created_at: Date.now()
		};

		const result = await db.collection('messages').insertOne(message);
		const insertedMessage = { ...message, _id: result.insertedId };

		broadcast('message', insertedMessage);
		res.status(201).json(insertedMessage);
	} catch (error) {
		console.error('Error sending message:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.get('/api/messages/:user', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const user = req.params.user;
		const messages = await db.collection('messages')
			.find({ $or: [{ sender: user }, { recipient: user }] })
			.sort({ created_at: -1 })
			.toArray();

		res.json(messages);
	} catch (error) {
		console.error('Error fetching messages:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

app.put('/api/messages/:id/read', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });
		const id = req.params.id;
		const objectId = toObjectId(id);
		if (!objectId) return res.status(400).json({ error: 'Invalid message ID' });

		const result = await db.collection('messages').updateOne(
			{ _id: objectId },
			{ $set: { read: true } }
		);

		if (result.modifiedCount === 0) {
			return res.status(404).json({ error: 'Message not found or already marked as read' });
		}

		res.json({ success: true });
	} catch (error) {
		console.error('Error marking message as read:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Leaderboard system endpoint
app.get('/api/leaderboard', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });

		// Get all listings with owner information
		const listings = await db.collection('listings').find({}).toArray();

		// Create a map of provider contributions
		const providerMap = {};
		for (const listing of listings) {
			if (!listing.owner_email) continue;

			if (!providerMap[listing.owner_email]) {
				// Initialize with default values
				providerMap[listing.owner_email] = {
					email: listing.owner_email,
					name: listing.owner_email, // Default to email if name not found
					listings: 0,
					total_quantity: 0,
					completed_listings: 0
				};
			}

			// Update the name for this provider based on the current listing
			// Priority: provider_name > owner_name > contact > email
			if (listing.provider_name && listing.provider_name.trim()) {
				providerMap[listing.owner_email].name = listing.provider_name.trim();
			} else if (listing.owner_name && listing.owner_name.trim()) {
				providerMap[listing.owner_email].name = listing.owner_name.trim();
			} else if (listing.contact && listing.contact.trim()) {
				providerMap[listing.owner_email].name = listing.contact.trim();
			}

			providerMap[listing.owner_email].listings += 1;
			providerMap[listing.owner_email].total_quantity += parseQuantity(listing.quantity);
			if (listing.status === 'completed') {
				providerMap[listing.owner_email].completed_listings += 1;
			}
		}

		// Convert to array and sort by total quantity in descending order
		const providers = Object.values(providerMap);
		providers.sort((a, b) => b.total_quantity - a.total_quantity);

		// Debug logging
		console.log('Leaderboard data:', {
			totalProviders: providers.length,
			providers: providers.map(p => ({
				email: p.email,
				name: p.name,
				listings: p.listings,
				total_quantity: p.total_quantity
			}))
		});

		// Return top 5 providers
		res.json(providers.slice(0, 5));
	} catch (error) {
		console.error('Error fetching leaderboard:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Carbon calculation and tracking endpoints

// Calculate carbon emissions for food waste
app.post('/api/carbon/calculate', async (req, res) => {
	try {
		const {
			foodWasteKg,
			foodType,
			location
		} = req.body;

		if (!foodWasteKg || foodWasteKg <= 0) {
			return res.status(400).json({ error: 'Food waste amount must be greater than 0' });
		}

		const result = await carbonCalculator.calculateFoodWasteEmissions({
			foodWasteKg,
			foodType,
			location
		});

		if (!result.success) {
			return res.status(500).json({ error: result.error });
		}

		res.json(result.data);
	} catch (error) {
		console.error('Error calculating carbon emissions:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Calculate carbon emissions for a specific listing
app.post('/api/carbon/calculate-listing/:id', async (req, res) => {
	try {
		if (!db) return res.status(503).json({ error: 'Database not connected' });

		const id = req.params.id;
		const objectId = toObjectId(id);
		if (!objectId) return res.status(400).json({ error: 'Invalid listing ID' });

		const listing = await db.collection('listings').findOne({ _id: objectId });
		if (!listing) return res.status(404).json({ error: 'Listing not found' });

		const { transportMethod, distanceKm } = req.body;

		const result = await carbonCalculator.calculateListingEmissions(listing, {
			transportMethod: transportMethod || 'car',
			distanceKm: distanceKm || 5
		});

		if (!result.success) {
			return res.status(500).json({ error: result.error });
		}

		res.json(result.data);
	} catch (error) {
		console.error('Error calculating listing emissions:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Track carbon emissions for a listing
app.post('/api/carbon/track', async (req, res) => {
	try {
		const {
			listing_id,
			pickup_id,
			user_email,
			user_name,
			emissions_data
		} = req.body;

		if (!listing_id || !user_email || !emissions_data) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		// Calculate carbon credit value
		const carbonCreditValue = carbonCalculator.calculateCarbonCreditValue(
			emissions_data.carbon_credits.net,
			'average'
		);

		const trackingData = {
			listing_id,
			pickup_id,
			user_email,
			user_name,
			food_waste_kg: emissions_data.foodWasteKg,
			food_type: emissions_data.foodType,
			transport_method: emissions_data.transportMethod || null,
			distance_km: emissions_data.distanceKm || null,
			emissions: {
				food_waste: emissions_data.emissions?.foodWaste || emissions_data.emissions?.food_waste || 0,
				transportation: emissions_data.emissions?.transportation || 0,
				total: emissions_data.emissions?.total || 0
			},
			carbon_credits: {
				generated: emissions_data.carbon_credits?.generated || emissions_data.carbonCredits?.generated || 0,
				avoided: emissions_data.carbon_credits?.avoided || emissions_data.carbonCredits?.avoided || 0,
				net: emissions_data.carbon_credits?.net || emissions_data.carbonCredits?.net || 0
			},
			environmental_impact: emissions_data.environmentalImpact || emissions_data.environmental_impact || null,
			carbon_credit_value: carbonCreditValue
		};

		const record = await carbonTracking.createRecord(trackingData);

		// Broadcast the new carbon tracking record
		broadcast('carbon_tracked', record);

		res.status(201).json(record);
	} catch (error) {
		console.error('Error tracking carbon emissions:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Get carbon tracking records for a user
app.get('/api/carbon/records/:user', async (req, res) => {
	try {
		const user = req.params.user;
		const records = await carbonTracking.getUserRecords(user);
		res.json(records);
	} catch (error) {
		console.error('Error fetching carbon records:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Get carbon tracking records for a listing
app.get('/api/carbon/records-listing/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const records = await carbonTracking.getListingRecords(id);
		res.json(records);
	} catch (error) {
		console.error('Error fetching listing carbon records:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Get carbon summary statistics
app.get('/api/carbon/summary', async (req, res) => {
	try {
		const { user_email } = req.query;
		const summary = await carbonTracking.getCarbonSummary(user_email);
		res.json(summary);
	} catch (error) {
		console.error('Error fetching carbon summary:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Get top carbon contributors
app.get('/api/carbon/leaderboard', async (req, res) => {
	try {
		const { limit = 10 } = req.query;
		const contributors = await carbonTracking.getTopCarbonContributors(parseInt(limit));
		res.json(contributors);
	} catch (error) {
		console.error('Error fetching carbon leaderboard:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Verify carbon credits
app.post('/api/carbon/verify/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const { verifier_email, verification_notes } = req.body;

		if (!verifier_email) {
			return res.status(400).json({ error: 'Verifier email is required' });
		}

		const record = await carbonTracking.verifyCarbonCredits(
			id,
			verifier_email,
			verification_notes || ''
		);

		// Broadcast the verification
		broadcast('carbon_verified', record);

		res.json(record);
	} catch (error) {
		console.error('Error verifying carbon credits:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Mark carbon credits as traded
app.post('/api/carbon/trade/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const { trade_details } = req.body;

		if (!trade_details) {
			return res.status(400).json({ error: 'Trade details are required' });
		}

		const record = await carbonTracking.markCreditsAsTraded(id, trade_details);

		// Broadcast the trade
		broadcast('carbon_traded', record);

		res.json(record);
	} catch (error) {
		console.error('Error marking carbon credits as traded:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Get carbon credit conversion rates
app.get('/api/carbon/rates', (_req, res) => {
	try {
		const rates = carbonCalculator.getCarbonCreditRates();
		res.json(rates);
	} catch (error) {
		console.error('Error fetching carbon credit rates:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Serve Next.js static files from the client build
app.use(express.static(path.join(__dirname, '..', 'public', 'client')));

// Catch-all route to serve index.html for client-side routing
// This must be AFTER all API routes
app.get('*', (req, res) => {
	// Don't serve index.html for API routes
	if (req.path.startsWith('/api')) {
		return res.status(404).json({ error: 'API endpoint not found' });
	}
	res.sendFile(path.join(__dirname, '..', 'public', 'client', 'index.html'));
});


// Try to use the specified port or find an available one
const startPort = process.env.PORT || 3000;
const maxPortAttempts = 10; // Try up to 10 ports

async function findAvailablePort(startingPort, maxAttempts) {
	const net = await import('net');
	let port = startingPort;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const isAvailable = await new Promise((resolve, reject) => {
			const server = net.createServer();
			server.on('error', (err) => {
				if (err.code === 'EADDRINUSE') {
					server.close();
					resolve(false); // Port is in use
				} else {
					reject(err);
				}
			});
			server.listen(port, () => {
				server.close();
				resolve(true); // Port is available
			});
		});

		if (isAvailable) {
			return port; // Port is available, return it
		}

		// Port is in use, try the next one
		port++;
	}

	throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

async function startServer() {
	try {
		const PORT = await findAvailablePort(startPort, maxPortAttempts);

		console.log("Attempting to connect to MongoDB (Mongoose)...");
		await mongoose.connect(process.env.MONGODB_URI, {
			dbName: process.env.DB_NAME,
		});
		console.log("Mongoose connected successfully");

		console.log("Attempting to connect to MongoDB (Native Driver)...");
		const { db: database } = await connectToDatabase();
		db = database;
		console.log("Native MongoDB connected successfully");

		const server = app.listen(PORT, () => {
			console.log(`Server running on http://localhost:${PORT}`);
		});

		server.on("error", (err) => {
			console.error("Server error:", err);
			process.exit(1);
		});

		process.on("SIGINT", async () => {
			console.log("Shutting down gracefully...");
			await mongoose.disconnect();
			await closeDatabase();
			process.exit(0);
		});

	} catch (error) {
		console.error("Failed to start server:", error);
		process.exit(1);
	}
}


startServer();


