# 🌱 Carbon Calculator & CoolClimate API Integration

## Overview
This project now includes a comprehensive carbon emissions calculator that integrates with the CoolClimate API to calculate carbon emissions from food waste reduction and convert them to carbon credits.

## Features

### 🧮 Carbon Emissions Calculator
- **Food Waste Analysis**: Calculate emissions based on food type (meat, dairy, grains, vegetables, fruits)
- **Transportation Impact**: Account for different transport methods (car, truck, bicycle, walking, public transit)
- **Distance Calculation**: Factor in travel distance for accurate emission calculations
- **Real-time Results**: Instant calculation of environmental impact

### 💰 Carbon Credits System
- **Credit Generation**: Convert avoided emissions to carbon credits (1 metric ton CO2e = 1 credit)
- **Market Valuation**: Calculate credit value across different markets (voluntary, compliance, average)
- **Trading Platform**: Track, verify, and trade carbon credits
- **Verification System**: Multi-step verification process for credit authenticity

### 📊 Environmental Impact Metrics
- **Tree Equivalents**: Show impact in terms of trees planted
- **Car Miles Saved**: Convert emissions to equivalent car miles
- **Energy Savings**: Display impact in kilowatt-hours saved
- **Water Conservation**: Track water savings from food waste reduction

## API Endpoints

### Carbon Calculation
- `POST /api/carbon/calculate` - Calculate emissions for custom parameters
- `POST /api/carbon/calculate-listing/:id` - Calculate emissions for specific food listing
- `GET /api/carbon/rates` - Get carbon credit conversion rates

### Carbon Tracking
- `POST /api/carbon/track` - Track carbon emissions and generate credits
- `GET /api/carbon/records/:user` - Get user's carbon tracking records
- `GET /api/carbon/records-listing/:id` - Get carbon records for specific listing
- `GET /api/carbon/summary` - Get carbon summary statistics
- `GET /api/carbon/leaderboard` - Get top carbon contributors

### Credit Management
- `POST /api/carbon/verify/:id` - Verify carbon credits
- `POST /api/carbon/trade/:id` - Mark credits as traded

## Database Schema

### Carbon Tracking Collection
```javascript
{
  _id: ObjectId,
  listing_id: String,           // Associated food listing (optional)
  pickup_id: String,            // Associated pickup (optional)
  user_email: String,           // User who generated credits
  user_name: String,            // User's display name
  food_waste_kg: Number,        // Amount of food waste reduced
  food_type: String,            // Type of food (meat, dairy, etc.)
  transport_method: String,     // Transportation method used
  distance_km: Number,          // Distance traveled
  emissions: {
    food_waste: Number,         // Emissions from food waste
    transportation: Number,     // Emissions from transportation
    total: Number               // Total emissions
  },
  carbon_credits: {
    generated: Number,          // Credits generated
    avoided: Number,            // Credits from avoided waste
    net: Number                 // Net carbon credits
  },
  environmental_impact: Object, // Environmental equivalents
  carbon_credit_value: Object,  // Credit valuation
  status: String,               // pending, verified, traded
  created_at: Number,           // Timestamp
  updated_at: Number            // Last update timestamp
}
```

## Usage Examples

### Calculate Carbon Emissions
```javascript
const response = await fetch('/api/carbon/calculate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    foodWasteKg: 5.0,
    foodType: 'mixed',
    transportMethod: 'car',
    distanceKm: 3.0
  })
});

const result = await response.json();
console.log('Carbon credits earned:', result.carbonCredits.net);
```

### Track Carbon Impact
```javascript
const response = await fetch('/api/carbon/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_email: 'user@example.com',
    user_name: 'John Doe',
    transport_method: 'bicycle',
    distance_km: 2.0,
    emissions_data: calculationResult
  })
});
```

## Frontend Integration

### Dashboard Integration
The carbon calculator is integrated into the main dashboard with:
- **Carbon Calculator Card**: Easy access to emission calculations
- **Modal Interface**: User-friendly form for input parameters
- **Real-time Results**: Instant display of environmental impact
- **Credit Tracking**: Seamless integration with user accounts

### User Experience
1. **Click Carbon Calculator** from dashboard
2. **Enter Parameters**: Food waste amount, type, transport method, distance
3. **Calculate Impact**: Get instant environmental impact results
4. **Track Credits**: Save calculation and earn carbon credits
5. **View History**: Access personal carbon tracking records

## Environmental Impact Factors

### Food Type Emission Factors (kg CO2e per kg)
- **Meat**: 13.3 (highest impact)
- **Dairy**: 2.4
- **Grains**: 0.5
- **Vegetables**: 0.4
- **Fruits**: 0.4
- **Mixed**: 2.5 (average)

### Transportation Emission Factors (kg CO2e per km)
- **Car**: 0.2
- **Truck**: 0.8
- **Bicycle**: 0 (no emissions)
- **Walking**: 0 (no emissions)
- **Public Transit**: 0.1

## Carbon Credit Markets

### Market Types
- **Voluntary Market**: $3.50 per credit (individual/company purchases)
- **Compliance Market**: $15.00 per credit (regulatory requirements)
- **Average Market**: $9.25 per credit (blended rate)

### Credit Verification
- **Verification Cost**: $2.00 per credit
- **Trading Fee**: 10% of credit value
- **Net Value**: Gross value minus verification and trading costs

## Future Enhancements

### Planned Features
- **Geolocation Integration**: Automatic distance calculation
- **Real-time Market Data**: Live carbon credit prices
- **Blockchain Integration**: Secure credit verification
- **Mobile App**: Native mobile carbon calculator
- **API Rate Limiting**: Enhanced CoolClimate API integration

### Advanced Analytics
- **Trend Analysis**: Historical emission patterns
- **Predictive Modeling**: Future impact projections
- **Comparative Analysis**: Benchmark against industry standards
- **Sustainability Reporting**: Automated impact reports

## Technical Requirements

### Dependencies
- `axios`: HTTP client for API requests
- `node-fetch`: Fetch API for Node.js
- `express`: Web framework
- `mongodb`: Database for carbon tracking

### Environment Variables
```bash
COOLCLIMATE_API_KEY=your_api_key_here
```

### API Rate Limits
- **CoolClimate API**: 1000 requests per hour (with valid API key)
- **Demo Mode**: Limited functionality without API key

## Contributing

### Development Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Set environment variables
4. Start development server: `npm run dev`

### Testing
- Test carbon calculations with various food types
- Verify credit generation and tracking
- Test API endpoints with different parameters
- Validate environmental impact calculations

## Support

### Documentation
- API documentation available at `/api/carbon/*`
- Frontend integration examples in dashboard
- Database schema documentation

### Issues
- Report bugs via GitHub issues
- Include reproduction steps and error logs
- Provide environment details and API responses

---

**Built with ❤️ for a sustainable future**
*Every food waste reduction counts towards carbon neutrality*
