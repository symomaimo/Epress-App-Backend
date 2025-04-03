const express = require("express");
const router = express.Router();
const Fees = require("../../models/fees/Fees");
const Student = require("../../models/student/Student");
const Class = require("../../models/class/Class");
// Record a Payment
router.post('/', async (req, res) => {
  console.log(req.body);  // This will log the body of the incoming request
  try {
    const { studentId, amountPaid, paymentMethod,datePaid } = req.body; // Include paymentMethod

    if (!studentId || !amountPaid || !paymentMethod || !datePaid) {
      return res.status(400).json({ message: 'All fields are required: studentId, amountPaid, paymentMethod,datepaid. ' });
    }

    // Find the student
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    // Find the class to get the total fees
    const classData = await Class.findOne({ studentclass: student.studentclass });

    if (!classData) {
      return res.status(404).json({ message: 'Class not found for the student.' });
    }

    const totalFees = classData.fees;

    // Calculate the new balance and carry-over
    const newTotalPaid = student.feesPaid + amountPaid;
    const previousBalance = student.carryOver || 0; // Previous carry-over
    const newBalance = totalFees + previousBalance - newTotalPaid; // Adjust with previous carry-over
    let carryOver = 0;

    if (newBalance < 0) {
      carryOver = Math.abs(newBalance); // Excess payment becomes carry-over
    }

    // Update the student fees record
    student.feesPaid = newTotalPaid;
    student.carryOver = carryOver;
    await student.save();

    // Save the payment details in the Fees model
    const feesRecord = new Fees({
      student: studentId,
      amountPaid,
      datePaid: new Date(datePaid),  // ✅ Ensure datePaid is used
      balance: newBalance >= 0 ? newBalance : 0,
      carryOver,
      paymentMethod,  // ✅ Ensure this is included
    });

    await feesRecord.save();

    res.status(201).json({
      message: 'Payment recorded successfully.',
      feesRecord,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Get all Payments
router.get('/', async (req, res) => {
  try {
    const feesRecords = await Fees.find().populate('student', 'name');
    res.status(200).json(feesRecords);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Get a single Payment
router.get('/:id', async (req, res) => {
  try {
    const feesRecord = await Fees.findById(req.params.id).populate('student', 'name');
    if (!feesRecord) {
      return res.status(404).json({ message: 'Payment record not found.' });
    }
    res.status(200).json(feesRecord);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Update a Payment
router.put('/:id', async (req, res) => {
  try {
    const { amountPaid, paymentMethod, datePaid } = req.body;

    if (!amountPaid || !paymentMethod || !datePaid) {
      return res.status(400).json({ message: 'All fields are required: amountPaid, paymentMethod, datePaid.' });
    }

    const feesRecord = await Fees.findByIdAndUpdate(
      req.params.id,
      { amountPaid, paymentMethod, datePaid },
      { new: true }
    );

    if (!feesRecord) {
      return res.status(404).json({ message: 'Payment record not found.' });
    }

    res.status(200).json(feesRecord);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Delete a Payment
router.delete('/:id', async (req, res) => {
  try {
    const feesRecord = await Fees.findByIdAndDelete(req.params.id);
    if (!feesRecord) {
      return res.status(404).json({ message: 'Payment record not found.' });
    }
    res.status(200).json({ message: 'Payment record deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Get all payments for a specific student
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const feesRecords = await Fees.find({ student: studentId }).populate('student', 'name');
    res.status(200).json(feesRecords);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Get all payments for a specific class
router.get('/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    const studentsInClass = await Student.find({ studentclass: classId });
    const studentIds = studentsInClass.map(student => student._id);
    const feesRecords = await Fees.find({ student: { $in: studentIds } }).populate('student', 'name');
    res.status(200).json(feesRecords);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Get all payments for a specific date
router.get('/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const feesRecords = await Fees.find({ datePaid: new Date(date) }).populate('student', 'name');
    res.status(200).json(feesRecords);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
module.exports = router;