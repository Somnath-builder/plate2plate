import { connectToDatabase } from './src/config/database.js';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
    try {
        const { db } = await connectToDatabase();
        if (!db) {
            console.log('Database not connected');
            process.exit(1);
        }
        const listings = await db.collection('listings').countDocuments({});
        const completed = await db.collection('listings').countDocuments({ status: 'completed' });
        const pickups = await db.collection('pickups').countDocuments({});
        console.log(JSON.stringify({ listings, completed, pickups }));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
check();
