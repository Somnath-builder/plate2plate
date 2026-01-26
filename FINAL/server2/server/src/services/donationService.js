import Donation from "../models/Donation.js";

/**
 * Create a new donation
 */
export const createDonation = async (donationData) => {
  const donation = await Donation.create(donationData);
  return donation;
};

/**
 * Get all donations
 */
export const getAllDonations = async () => {
  return Donation.find().sort({ createdAt: -1 });
};

/**
 * Get a single donation by ID
 */
export const getDonationById = async (id) => {
  return Donation.findById(id);
};

/**
 * Delete a donation (optional)
 */
export const deleteDonation = async (id, donorId) => {
  const donation = await Donation.findOneAndDelete({
    _id: id,
    donorId,
  });

  return donation;
};
