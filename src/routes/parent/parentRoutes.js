const express = require("express");
const router = express.Router();
const Parent = require("../../models/parent/Parent");
//ADD A PARENT
router.post("/", async (req, res) => {
  try {
    const { name, phone, residence, email } = req.body;
    //check if parent exists
    const parent = await Parent.findOne({ phone });
    if (parent) {
      return res.status(400).json({ msg: "Parent already exists" });
    }
    //create new parent
    const newParent = new Parent({ name, phone, residence, email });
    await newParent.save();
    res.status(201).json(newParent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Server error" });
  }
});
//UPDATE A PARENT
router.put("/:id", async (req, res) => {
  try {
    const { name, phone, residence, email } = req.body;
    const updatedParent = await Parent.findByIdAndUpdate(req.params.id, {
      name,
      phone,
      residence,
      email,
    });
    if (!updatedParent) {
      return res.status(404).json({ msg: "Parent not found" });
    }
    const newUpdatedParent = await Parent.findById(req.params.id);
    res.status(200).json(newUpdatedParent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});
//find all parents
router.get("/", async (req, res) => {
  try {
    const parents = await Parent.find();
    res.status(200).json(parents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// get parent by id
router.get("/:id", async (req, res) => {
  try {
    const parent = await Parent.findById(req.params.id);
    if (!parent) {
      return res.status(404).json({ msg: "Parent not found" });
    }
    res.status(200).json(parent);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// delete parent
router.delete("/:id", async (req, res) => {
  try {
    const parent = await Parent.findByIdAndDelete(req.params.id);
    if (!parent) {
      return res.status(404).json({ msg: "Parent not found" });
    }
    res.status(204).json({ msg: "Parent deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
