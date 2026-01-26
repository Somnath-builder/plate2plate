import { connectToDatabase, toObjectId } from '../config/database.js';

class CarbonTracking {
    constructor() {
        this.db = null;
        this.collection = 'carbon_tracking';
    }

    async init() {
        if (!this.db) {
            const { db } = await connectToDatabase();
            this.db = db;
        }
    }

    /**
     * Create a new carbon tracking record
     * @param {Object} data - Carbon tracking data
     * @returns {Object} Created record
     */
    async createRecord(data) {
        await this.init();
        
        const record = {
            listing_id: data.listing_id,
            pickup_id: data.pickup_id || null,
            user_email: data.user_email,
            user_name: data.user_name,
            food_waste_kg: data.food_waste_kg,
            food_type: data.food_type,
            transport_method: data.transport_method,
            distance_km: data.distance_km,
            emissions: {
                food_waste: data.emissions.food_waste,
                transportation: data.emissions.transportation,
                total: data.emissions.total
            },
            carbon_credits: {
                generated: data.carbon_credits.generated,
                avoided: data.carbon_credits.avoided,
                net: data.carbon_credits.net
            },
            environmental_impact: data.environmental_impact,
            carbon_credit_value: data.carbon_credit_value || null,
            status: 'pending', // pending, verified, traded
            created_at: Date.now(),
            updated_at: Date.now()
        };

        const result = await this.db.collection(this.collection).insertOne(record);
        return { ...record, _id: result.insertedId };
    }

    /**
     * Get carbon tracking records for a user
     * @param {string} userEmail - User's email
     * @returns {Array} Array of carbon tracking records
     */
    async getUserRecords(userEmail) {
        await this.init();
        
        return await this.db.collection(this.collection)
            .find({ user_email: userEmail })
            .sort({ created_at: -1 })
            .toArray();
    }

    /**
     * Get carbon tracking records for a listing
     * @param {string} listingId - Listing ID
     * @returns {Array} Array of carbon tracking records
     */
    async getListingRecords(listingId) {
        await this.init();
        
        const objectId = toObjectId(listingId);
        if (!objectId) return [];
        
        return await this.db.collection(this.collection)
            .find({ listing_id: listingId })
            .sort({ created_at: -1 })
            .toArray();
    }

    /**
     * Get all carbon tracking records
     * @param {Object} filters - Optional filters
     * @returns {Array} Array of carbon tracking records
     */
    async getAllRecords(filters = {}) {
        await this.init();
        
        const query = {};
        if (filters.status) query.status = filters.status;
        if (filters.user_email) query.user_email = filters.user_email;
        if (filters.date_from) query.created_at = { $gte: filters.date_from };
        if (filters.date_to) query.created_at = { ...query.created_at, $lte: filters.date_to };

        return await this.db.collection(this.collection)
            .find(query)
            .sort({ created_at: -1 })
            .toArray();
    }

    /**
     * Update carbon tracking record status
     * @param {string} recordId - Record ID
     * @param {string} status - New status
     * @param {Object} additionalData - Additional data to update
     * @returns {Object} Updated record
     */
    async updateRecordStatus(recordId, status, additionalData = {}) {
        await this.init();
        
        const objectId = toObjectId(recordId);
        if (!objectId) throw new Error('Invalid record ID');

        const updateData = {
            status,
            updated_at: Date.now(),
            ...additionalData
        };

        const result = await this.db.collection(this.collection).updateOne(
            { _id: objectId },
            { $set: updateData }
        );

        if (result.modifiedCount === 0) {
            throw new Error('Record not found or not updated');
        }

        return await this.db.collection(this.collection).findOne({ _id: objectId });
    }

    /**
     * Get carbon summary statistics
     * @param {string} userEmail - Optional user email filter
     * @returns {Object} Carbon summary statistics
     */
    async getCarbonSummary(userEmail = null) {
        await this.init();
        
        const matchStage = userEmail ? { user_email: userEmail } : {};
        
        const pipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: null,
                    totalRecords: { $sum: 1 },
                    totalFoodWasteKg: { $sum: '$food_waste_kg' },
                    totalEmissions: { $sum: '$emissions.total' },
                    totalCarbonCredits: { $sum: '$carbon_credits.net' },
                    totalAvoidedEmissions: { $sum: '$carbon_credits.avoided' },
                    averageEmissions: { $avg: '$emissions.total' },
                    averageCarbonCredits: { $avg: '$carbon_credits.net' }
                }
            }
        ];

        const result = await this.db.collection(this.collection).aggregate(pipeline).toArray();
        
        if (result.length === 0) {
            return {
                totalRecords: 0,
                totalFoodWasteKg: 0,
                totalEmissions: 0,
                totalCarbonCredits: 0,
                totalAvoidedEmissions: 0,
                averageEmissions: 0,
                averageCarbonCredits: 0
            };
        }

        return result[0];
    }

    /**
     * Get carbon tracking records by date range
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @param {string} userEmail - Optional user email filter
     * @returns {Array} Array of carbon tracking records
     */
    async getRecordsByDateRange(startDate, endDate, userEmail = null) {
        await this.init();
        
        const query = {
            created_at: {
                $gte: startDate.getTime(),
                $lte: endDate.getTime()
            }
        };

        if (userEmail) {
            query.user_email = userEmail;
        }

        return await this.db.collection(this.collection)
            .find(query)
            .sort({ created_at: -1 })
            .toArray();
    }

    /**
     * Get top carbon contributors
     * @param {number} limit - Number of top contributors to return
     * @returns {Array} Array of top carbon contributors
     */
    async getTopCarbonContributors(limit = 10) {
        await this.init();
        
        const pipeline = [
            {
                $group: {
                    _id: '$user_email',
                    user_name: { $first: '$user_name' },
                    totalCarbonCredits: { $sum: '$carbon_credits.net' },
                    totalEmissions: { $sum: '$emissions.total' },
                    totalFoodWasteKg: { $sum: '$food_waste_kg' },
                    recordCount: { $sum: 1 }
                }
            },
            { $sort: { totalCarbonCredits: -1 } },
            { $limit: limit }
        ];

        return await this.db.collection(this.collection).aggregate(pipeline).toArray();
    }

    /**
     * Verify carbon credits for a record
     * @param {string} recordId - Record ID
     * @param {string} verifierEmail - Verifier's email
     * @param {string} verificationNotes - Verification notes
     * @returns {Object} Updated record
     */
    async verifyCarbonCredits(recordId, verifierEmail, verificationNotes = '') {
        await this.init();
        
        const objectId = toObjectId(recordId);
        if (!objectId) throw new Error('Invalid record ID');

        const updateData = {
            status: 'verified',
            verified_at: Date.now(),
            verifier_email: verifierEmail,
            verification_notes: verificationNotes,
            updated_at: Date.now()
        };

        const result = await this.db.collection(this.collection).updateOne(
            { _id: objectId },
            { $set: updateData }
        );

        if (result.modifiedCount === 0) {
            throw new Error('Record not found or not updated');
        }

        return await this.db.collection(this.collection).findOne({ _id: objectId });
    }

    /**
     * Mark carbon credits as traded
     * @param {string} recordId - Record ID
     * @param {Object} tradeDetails - Trade details
     * @returns {Object} Updated record
     */
    async markCreditsAsTraded(recordId, tradeDetails) {
        await this.init();
        
        const objectId = toObjectId(recordId);
        if (!objectId) throw new Error('Invalid record ID');

        const updateData = {
            status: 'traded',
            traded_at: Date.now(),
            trade_details: tradeDetails,
            updated_at: Date.now()
        };

        const result = await this.db.collection(this.collection).updateOne(
            { _id: objectId },
            { $set: updateData }
        );

        if (result.modifiedCount === 0) {
            throw new Error('Record not found or not updated');
        }

        return await this.db.collection(this.collection).findOne({ _id: objectId });
    }
}

export default CarbonTracking;
