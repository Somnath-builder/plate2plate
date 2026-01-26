# Database Setup Guide

## Quick Start (In-Memory Database - For Testing)

The application now includes an **in-memory database fallback** that works without MongoDB installation. This is perfect for testing and development.

**Note:** Data will be lost when the server restarts. For production use, please set up MongoDB.

## Production Setup (MongoDB)

### Option 1: MongoDB Atlas (Cloud - Recommended)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up for a free account
3. Create a new cluster (free tier available)
4. Create a database user
5. Get your connection string
6. Create a `.env` file in this directory:

```env
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
DB_NAME=campus-food-redistribution
PORT=9876
```

### Option 2: Local MongoDB

1. Download and install MongoDB from [mongodb.com](https://www.mongodb.com/try/download/community)
2. Start MongoDB service
3. Create a `.env` file (optional, defaults work):

```env
MONGODB_URI=mongodb://localhost:27017
DB_NAME=campus-food-redistribution
PORT=9876
```

## Current Status

The server will automatically:
- Try to connect to MongoDB first
- Fall back to in-memory database if MongoDB is not available
- Show a warning message in the console

You can now use the application with the in-memory database for testing!
