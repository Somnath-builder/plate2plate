import mongoose from "mongoose";

const donationSchema = new mongoose.Schema(
  {
    foodCategory: {
      type: String,
      enum: ["raw", "packaged"],
      required: true,
    },

    foodName: {
      type: String,
      required: true,
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 0.1,
    },

    unit: {
      type: String,
      enum: ["kg", "liters", "packets"],
      required: true,
    },

    expiryDate: {
      type: Date,
      required: true,
    },

    storageType: {
      type: String,
      enum: ["ambient", "refrigerated"],
      required: true,
    },

    condition: {
      type: String,
      enum: ["sealed", "loose", "fresh"],
      required: true,
    },

    pickupStartDate: {
      type: Date,
      required: true,
    },

    pickupEndDate: {
      type: Date,
      required: true,
      validate: {
        validator: function (value) {
          return value > this.pickupStartDate;
        },
        message: "Pickup end date must be after pickup start date",
      },
    },

    donorId: {
      type: String, // simple & safe for now
      required: true,
    },

    status: {
      type: String,
      enum: ["available", "reserved", "completed"],
      default: "available",
    },

    receiverId: {
      type: String,
      default: null,
    },

    donorContact: {
      type: String,
      trim: true,
    },

    donorAddress: {
      type: String,
      trim: true,
    },

    pickupLocation: {
      type: String,
      trim: true,
    },

    latitude: {
      type: Number,
      default: null,
    },

    longitude: {
      type: Number,
      default: null,
    },

    code: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Donation", donationSchema);
