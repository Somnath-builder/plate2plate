import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'campus-food-redistribution';

let client = null;
let db = null;
let useMemoryDB = false;

// Simple in-memory database fallback
class InMemoryDB {
  constructor() {
    this.collections = {};
  }

  collection(name) {
    if (!this.collections[name]) {
      this.collections[name] = [];
    }
    return new InMemoryCollection(this.collections[name]);
  }

  async listCollections() {
    const collections = Object.keys(this.collections).map(name => ({ name }));
    let index = 0;
    return {
      hasNext: () => index < collections.length,
      next: async () => {
        if (index < collections.length) {
          return { value: collections[index++], done: false };
        }
        return { done: true };
      }
    };
  }

  async createCollection(name) {
    if (!this.collections[name]) {
      this.collections[name] = [];
    }
  }
}

class InMemoryCollection {
  constructor(data) {
    this.data = data;
  }

  async createIndex() {
    // Indexes not needed for in-memory
  }

  async insertOne(doc) {
    const _id = this._generateId();
    this.data.push({ ...doc, _id });
    return { insertedId: _id, acknowledged: true };
  }

  async findOne(query) {
    return this.data.find(doc => this._matchesQuery(doc, query)) || null;
  }

  async find(query = {}) {
    const results = this.data.filter(doc => this._matchesQuery(doc, query));
    return {
      toArray: async () => results,
      sort: (sortSpec) => {
        results.sort((a, b) => {
          for (const [field, direction] of Object.entries(sortSpec)) {
            const aVal = a[field];
            const bVal = b[field];
            if (aVal !== bVal) {
              return direction === 1 ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
            }
          }
          return 0;
        });
        return { toArray: async () => results };
      },
      limit: (n) => {
        return { toArray: async () => results.slice(0, n) };
      }
    };
  }

  async updateOne(filter, update) {
    const index = this.data.findIndex(doc => this._matchesQuery(doc, filter));
    if (index === -1) return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
    if (update.$set) Object.assign(this.data[index], update.$set);
    return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
  }

  async updateMany(filter, update) {
    let matched = 0, modified = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (this._matchesQuery(this.data[i], filter)) {
        matched++;
        if (update.$set) {
          Object.assign(this.data[i], update.$set);
          modified++;
        }
      }
    }
    return { matchedCount: matched, modifiedCount: modified, acknowledged: true };
  }

  async deleteOne(filter) {
    const index = this.data.findIndex(doc => this._matchesQuery(doc, filter));
    if (index === -1) return { deletedCount: 0, acknowledged: true };
    this.data.splice(index, 1);
    return { deletedCount: 1, acknowledged: true };
  }

  async deleteMany(filter) {
    let deleted = 0;
    for (let i = this.data.length - 1; i >= 0; i--) {
      if (this._matchesQuery(this.data[i], filter)) {
        this.data.splice(i, 1);
        deleted++;
      }
    }
    return { deletedCount: deleted, acknowledged: true };
  }

  async countDocuments(filter = {}) {
    return this.data.filter(doc => this._matchesQuery(doc, filter)).length;
  }

  _generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  _matchesQuery(doc, query) {
    for (const [key, value] of Object.entries(query)) {
      if (key === '_id') {
        if (doc._id !== value && doc._id?.toString() !== value?.toString()) return false;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if ('$lte' in value && doc[key] > value.$lte) return false;
        if ('$gte' in value && doc[key] < value.$gte) return false;
        if ('$in' in value && !value.$in.includes(doc[key])) return false;
        if ('$ne' in value && doc[key] === value.$ne) return false;
      } else if (doc[key] !== value) return false;
    }
    return true;
  }
}

export async function connectToDatabase() {
  if (db) return { client, db };

  // Try MongoDB first
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);

    await db.collection('listings').createIndex({ created_at: -1 });
    await db.collection('listings').createIndex({ status: 1 });
    await db.collection('listings').createIndex({ expires_at: 1 });
    await db.collection('pickups').createIndex({ listing_id: 1 });
    await db.collection('events').createIndex({ starts_at: 1 });
    await db.collection('events').createIndex({ ends_at: 1 });

    useMemoryDB = false;
    console.log('Connected to MongoDB successfully');
    return { client, db };
  } catch (error) {
    // Fallback to in-memory database
    console.warn('MongoDB connection failed, using in-memory database:', error.message);
    console.warn('Note: Data will be lost when server restarts. For production, please set up MongoDB.');
    
    useMemoryDB = true;
    const memoryDb = new InMemoryDB();
    
    // Create collections
    await memoryDb.createCollection('listings');
    await memoryDb.createCollection('pickups');
    await memoryDb.createCollection('events');
    await memoryDb.createCollection('reviews');
    await memoryDb.createCollection('messages');
    await memoryDb.createCollection('carbon_tracking');
    
    db = memoryDb;
    return { client: null, db };
  }
}

export async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
  }
  db = null;
  useMemoryDB = false;
}

export function toObjectId(id) {
  if (!id) return null;
  if (useMemoryDB) {
    // For in-memory DB, just return the string
    return id.toString();
  }
  try { 
    return new ObjectId(id); 
  } catch { 
    return null; 
  }
}
