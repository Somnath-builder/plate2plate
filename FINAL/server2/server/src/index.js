import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dayjs from 'dayjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectToDatabase, closeDatabase, toObjectId } from './config/database.js';
import fs from 'fs';
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

// Mark carbon credits as traded
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


// Use the PORT environment variable (required for Render and other cloud platforms)
const PORT = process.env.PORT || 3000;

async function startServer() {
	try {

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


