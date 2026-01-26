import express from "express";
import Donation from "../models/donation.js";

const router = express.Router();

/**
 * GET all available donations
 * Visible to receivers
 */
router.get("/", async (_req, res) => {
  try {
    const donations = await Donation.find({ status: "available" }).sort({ createdAt: -1 });
    res.json(donations);
  } catch (err) {
    console.error("Fetch donations error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET reservations for a specific receiver
 */
router.get("/reservations", async (req, res) => {
  try {
    const receiverId = req.headers["x-user-id"];
    if (!receiverId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const reservations = await Donation.find({
      receiverId,
      status: { $in: ["reserved", "completed"] }
    }).sort({ createdAt: -1 });

    res.json(reservations);
  } catch (err) {
    console.error("Fetch reservations error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET donations for a specific provider/donor
 */
router.get("/my-donations", async (req, res) => {
  try {
    const donorId = req.headers["x-user-id"];
    if (!donorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const donations = await Donation.find({
      donorId
    }).sort({ createdAt: -1 });

    res.json(donations);
  } catch (err) {
    console.error("Fetch my donations error:", err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST create donation (provider)
 */
router.post("/", async (req, res) => {
  try {
    const donorId = req.headers["x-user-id"];
    if (!donorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const donation = await Donation.create({
      ...req.body,
      donorId,
      status: "available"
    });

    res.status(201).json(donation);
  } catch (err) {
    console.error("Create donation error:", err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST reserve donation (receiver)
 */
router.post("/:id/reserve", async (req, res) => {
  try {
    const receiverId = req.headers["x-user-id"];
    if (!receiverId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const donation = await Donation.findOne({
      _id: req.params.id,
      status: "available"
    });

    if (!donation) {
      return res.status(400).json({ error: "Donation not available" });
    }

    // Generate unique 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();

    donation.status = "reserved";
    donation.receiverId = receiverId;
    donation.code = code;
    await donation.save();

    res.json(donation);
  } catch (err) {
    console.error("Reserve error:", err);
    res.status(500).json({ error: "Failed to reserve donation" });
  }
});

/**
 * POST complete donation (provider) - verify code and mark as completed
 */
router.post("/:id/complete", async (req, res) => {
  try {
    const donorId = req.headers["x-user-id"];
    if (!donorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    const donation = await Donation.findOne({
      _id: req.params.id,
      donorId,
      status: "reserved"
    });

    if (!donation) {
      return res.status(404).json({ error: "Donation not found or not reserved" });
    }

    if (donation.code !== code.toString()) {
      return res.status(400).json({ error: "Invalid code" });
    }

    donation.status = "completed";
    await donation.save();

    res.json(donation);
  } catch (err) {
    console.error("Complete donation error:", err);
    res.status(500).json({ error: "Failed to complete donation" });
  }
});

export default router;
