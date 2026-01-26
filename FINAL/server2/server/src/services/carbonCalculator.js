import axios from 'axios';

// CoolClimate API configuration
const COOLCLIMATE_API_BASE = 'https://api.coolclimate.berkeley.edu';
const COOLCLIMATE_API_KEY = process.env.COOLCLIMATE_API_KEY || 'demo_key'; // You'll need to get a real API key

class CarbonCalculator {
    constructor() {
        this.apiKey = COOLCLIMATE_API_KEY;
        this.baseURL = COOLCLIMATE_API_BASE;
    }

    /**
     * Calculate carbon emissions for food waste reduction
     * @param {Object} params - Calculation parameters
     * @param {number} params.foodWasteKg - Food waste in kilograms
     * @param {string} params.foodType - Type of food (meat, dairy, grains, etc.)
     * @param {string} params.location - Geographic location for regional factors
     * @returns {Object} Carbon calculation results
     */
    async calculateFoodWasteEmissions(params) {
        try {
            const {
                foodWasteKg = 0,
                foodType = 'mixed',
                location = 'US'
            } = params;

            // Food waste emission factors (kg CO2e per kg of food)
            const foodEmissionFactors = {
                'meat': 13.3,      // Beef has highest emissions
                'dairy': 2.4,      // Dairy products
                'grains': 0.5,     // Grains and bread
                'vegetables': 0.4, // Vegetables
                'fruits': 0.4,     // Fruits
                'mixed': 2.5       // Average mixed food waste
            };

            // Calculate emissions from food waste
            const foodEmissions = foodWasteKg * (foodEmissionFactors[foodType] || foodEmissionFactors.mixed);
            
            // No transportation emissions (feature removed)
            const transportEmissions = 0;
            
            // Total emissions (only from food waste)
            const totalEmissions = foodEmissions;
            
            // Calculate carbon credits (1 carbon credit = 1 metric ton CO2e)
            // Since we're REDUCING food waste, we earn credits for the avoided emissions
            const avoidedEmissions = foodWasteKg * 2.5; // Average food waste emissions if not redistributed
            const carbonCredits = avoidedEmissions / 1000; // Convert to carbon credits

            return {
                success: true,
                data: {
                    foodWasteKg,
                    foodType,
                    location,
                    emissions: {
                        foodWaste: foodEmissions,
                        transportation: transportEmissions,
                        total: totalEmissions
                    },
                    carbonCredits: {
                        generated: 0, // No emissions generated from redistribution
                        avoided: carbonCredits, // Credits earned from avoiding waste
                        net: carbonCredits // Net credits = avoided emissions
                    },
                    environmentalImpact: {
                        treesEquivalent: Math.round(totalEmissions / 22), // 1 tree absorbs ~22kg CO2/year
                        carMilesEquivalent: Math.round(totalEmissions / 0.4), // 1 mile = 0.4kg CO2
                        energyEquivalent: Math.round(totalEmissions / 0.5) // 1 kWh = 0.5kg CO2
                    }
                }
            };
        } catch (error) {
            console.error('Error calculating carbon emissions:', error);
            return {
                success: false,
                error: 'Failed to calculate carbon emissions',
                details: error.message
            };
        }
    }

    /**
     * Calculate carbon emissions for a specific food listing
     * @param {Object} listing - Food listing object
     * @param {Object} pickup - Pickup information
     * @returns {Object} Carbon calculation results
     */
    async calculateListingEmissions(listing, pickup = null) {
        try {
            // Parse quantity from listing
            const quantityStr = listing.quantity || '0';
            const match = quantityStr.match(/(\d+(?:\.\d+)?)/);
            const foodWasteKg = match ? parseFloat(match[1]) : 0;

            // Determine food type based on listing title/type
            const foodType = this.categorizeFoodType(listing.title, listing.type);

            return await this.calculateFoodWasteEmissions({
                foodWasteKg,
                foodType,
                location: 'US' // Default location
            });
        } catch (error) {
            console.error('Error calculating listing emissions:', error);
            return {
                success: false,
                error: 'Failed to calculate listing emissions',
                details: error.message
            };
        }
    }

    /**
     * Categorize food type based on title and type
     * @param {string} title - Food listing title
     * @param {string} type - Food listing type
     * @returns {string} Categorized food type
     */
    categorizeFoodType(title, type) {
        const titleLower = (title || '').toLowerCase();
        const typeLower = (type || '').toLowerCase();

        if (titleLower.includes('meat') || titleLower.includes('beef') || titleLower.includes('chicken') || titleLower.includes('pork')) {
            return 'meat';
        }
        if (titleLower.includes('milk') || titleLower.includes('cheese') || titleLower.includes('yogurt') || titleLower.includes('dairy')) {
            return 'dairy';
        }
        if (titleLower.includes('bread') || titleLower.includes('rice') || titleLower.includes('pasta') || titleLower.includes('grains')) {
            return 'grains';
        }
        if (titleLower.includes('vegetable') || titleLower.includes('salad') || titleLower.includes('carrot') || titleLower.includes('tomato')) {
            return 'vegetables';
        }
        if (titleLower.includes('fruit') || titleLower.includes('apple') || titleLower.includes('banana') || titleLower.includes('orange')) {
            return 'fruits';
        }
        
        return 'mixed';
    }



    /**
     * Get carbon credit conversion rates
     * @returns {Object} Carbon credit conversion information
     */
    getCarbonCreditRates() {
        return {
            conversionRate: 1, // 1 metric ton CO2e = 1 carbon credit
            marketPrice: {
                voluntary: 3.50,    // Voluntary market price per credit (USD)
                compliance: 15.00,  // Compliance market price per credit (USD)
                average: 9.25       // Average market price per credit (USD)
            },
            verificationCost: 2.00, // Cost to verify carbon credits (USD per credit)
            tradingFee: 0.10       // Trading platform fee (10% of credit value)
        };
    }

    /**
     * Calculate carbon credit value
     * @param {number} carbonCredits - Number of carbon credits
     * @param {string} marketType - Market type (voluntary, compliance, average)
     * @returns {Object} Carbon credit value calculation
     */
    calculateCarbonCreditValue(carbonCredits, marketType = 'average') {
        const rates = this.getCarbonCreditRates();
        const basePrice = rates.marketPrice[marketType] || rates.marketPrice.average;
        
        const grossValue = carbonCredits * basePrice;
        const verificationCost = carbonCredits * rates.verificationCost;
        const tradingFee = grossValue * rates.tradingFee;
        const netValue = grossValue - verificationCost - tradingFee;
        
        return {
            carbonCredits,
            marketType,
            basePrice,
            grossValue: Math.round(grossValue * 100) / 100,
            verificationCost: Math.round(verificationCost * 100) / 100,
            tradingFee: Math.round(tradingFee * 100) / 100,
            netValue: Math.round(netValue * 100) / 100
        };
    }
}

export default CarbonCalculator;
