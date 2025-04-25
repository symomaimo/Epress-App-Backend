const express = require("express");
const router = express.Router();
const Fees = require("../../models/fees/Fees");
const Student = require("../../models/student/Student");
const Class = require("../../models/class/Class");
// Record a Payment
router.post('/', async (req, res) => {
  console.log(req.body);
  try {
    const { studentId, amountPaid, paymentMethod, datePaid, year, term } = req.body;

    if (!studentId || !amountPaid || !paymentMethod || !datePaid || !year || !term) {
      return res.status(400).json({ message: 'All fields are required: studentId, amountPaid, paymentMethod, datePaid, year, term.' });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const classData = await Class.findOne({ studentclass: student.studentclass });
    if (!classData) {
      return res.status(404).json({ message: 'Class not found for the student.' });
    }

    const totalFees = classData.fees;

    // Find total paid for the given semester
    const semesterPayments = await Fees.find({ student: studentId, year, term });
    const alreadyPaid = semesterPayments.reduce((acc, payment) => acc + payment.amountPaid, 0);
    const newTotalPaid = alreadyPaid + amountPaid;
    const newBalance = totalFees - newTotalPaid;

    // Calculate carryOver from overpayments (if any) for this semester
    let carryOver = 0;
    if (newBalance < 0) {
      carryOver = Math.abs(newBalance);
    }

    const feesRecord = new Fees({
      student: studentId,
      amountPaid,
      datePaid: new Date(datePaid),
      balance: newBalance >= 0 ? newBalance : 0,
      carryOver,
      paymentMethod,
      year,
      term,
    });

    await feesRecord.save();

    res.status(201).json({
      message: 'Payment recorded successfully.',
      feesRecord,
      totalPaidForSemester: newTotalPaid,
      carryOver
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

// Update a Payment and recalculate balance
router.put('/:id', async (req, res) => {
  try {
    const { amountPaid, paymentMethod, datePaid } = req.body;

    if (!amountPaid || !paymentMethod || !datePaid) {
      return res.status(400).json({ message: 'All fields are required: amountPaid, paymentMethod, datePaid.' });
    }

    const existingPayment = await Fees.findById(req.params.id);
    if (!existingPayment) {
      return res.status(404).json({ message: 'Payment record not found.' });
    }

    // Update the record
    existingPayment.amountPaid = amountPaid;
    existingPayment.paymentMethod = paymentMethod;
    existingPayment.datePaid = new Date(datePaid);
    await existingPayment.save();

    // Recalculate total paid for the term
    const payments = await Fees.find({
      student: existingPayment.student,
      year: existingPayment.year,
      term: existingPayment.term
    });

    const totalPaid = payments.reduce((sum, p) => sum + p.amountPaid, 0);

    const student = await Student.findById(existingPayment.student);
    const classData = await Class.findOne({ studentclass: student.studentclass });

    const balance = classData.fees - totalPaid;

    res.status(200).json({
      message: 'Payment updated.',
      updatedPayment: existingPayment,
      totalPaid,
      balance: balance >= 0 ? balance : 0
    });
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
    console.log('Looking up fees for student:', studentId);

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
// Get balance for a student in a given term/year
router.get('/balance/:studentId/:year/:term', async (req, res) => {
  const { studentId, year, term } = req.params;

  try {
    const student = await Student.findById(studentId);
    const classData = await Class.findOne({ studentclass: student.studentclass });
    const totalFees = classData.fees;

    const payments = await Fees.find({ student: studentId, year, term });
    const totalPaid = payments.reduce((sum, p) => sum + p.amountPaid, 0);

    const balance = totalFees - totalPaid;

    res.status(200).json({
      student: student.name,
      totalFees,
      totalPaid,
      balance: balance >= 0 ? balance : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Get all payments for a specific term and year


module.exports = router;
