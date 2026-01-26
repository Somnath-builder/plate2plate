# Plate2Plate Food Sharing Platform

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- MongoDB

### Installation
1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Configure environment variables in `.env` file:
   ```
   MONGODB_URI=your_mongodb_connection_string
   DB_NAME=your_database_name
   PORT=5000
   GOOGLE_MAPS_API_KEY=your_google_maps_api_key
   ```

### Google Maps API Key Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to "APIs & Services" > "Library"
4. Enable the following APIs:
   - Google Maps JavaScript API
   - Places API
   - Geocoding API
5. Go to "APIs & Services" > "Credentials"
6. Click "Create Credentials" > "API Key"
7. Copy the generated API key
8. (Optional but recommended) Restrict the API key to only the APIs you enabled and to your website's domain
9. Add the API key to your `.env` file as `GOOGLE_MAPS_API_KEY=your_api_key_here`

### Running the Application

```
npm start
```

The application will be available at http://localhost:5000

## Features

- Provider interface for listing available food
- Receiver interface for finding and claiming food
- Interactive maps for location selection and visualization
- Real-time updates via Server-Sent Events (SSE)
- Messaging system between providers and receivers
- Analytics dashboard

## Troubleshooting

### Map Not Loading

If you see the error "Oops! Something went wrong. This page didn't load Google Maps correctly":

1. Check that you've added a valid Google Maps API key to your `.env` file
2. Verify that you've enabled all required APIs (Maps JavaScript, Places, Geocoding)
3. Check browser console for specific error messages
4. If you've restricted your API key, ensure your domain is in the allowed list

### Server Connection Issues

If you see errors related to the SSE stream or API endpoints:

1. Ensure the server is running (`npm start`)
2. Check that the MongoDB connection is working
3. Verify the PORT in your `.env` file matches the port you're accessing