const express = require("express");
const router = express.Router();
const Class = require("../../models/class/Class");

// Add or update a class fees
router.post("/", async (req, res) => {
  try {
    const { studentclass, fees ,term,year} = req.body;
     classData = await Class.findOne({ studentclass });
    if (classData) {
      classData.fees = fees;
      await classData.save();
      return res.status(200).json(classData);
    }
    //if class does not exist, create a new class
    classData = Class.create({ studentclass, fees,term ,year });
    await classData.save();
    res.status(201).json({ msg: "Class fees added successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Server error" });
  }
});
// Get all classes
router.get("/", async (req, res) => {
  try {
    const classes = await Class.find();
    res.status(200).json(classes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Server error" });
  }
});
// Get a class by id
router.get("/:id", async (req, res) => {
  try {
    const classData = await Class.findById(req.params.id);
    if (!classData) {
      return res.status(404).json({ msg: "Class not found" });
    }
    res.status(200).json(classData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Server error" });
  }
});
//update a class
router.put("/:id", async (req, res) => {
  try {
    const { studentclass, fees } = req.body;
    const updatedClass = await Class.findByIdAndUpdate(req.params.id, {
      studentclass,
      fees,
    });
    if (!updatedClass) {
      return res.status(404).json({ msg: "Class not found" });
    }
    const newUpdatedClass = await Class.findById(req.params.id);
    res.status(200).json(newUpdatedClass);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Server error" });
  }
});
//DELETE A CLASS
router.delete("/:id", async (req, res) => {
  try {
    const classData = await Class.findByIdAndDelete(req.params.id);
    if (!classData) {
      return res.status(404).json({ msg: "Class not found" });
    }
    res.status(200).json({ msg: "Class deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Server error" });
  }
});
module.exports = router;
