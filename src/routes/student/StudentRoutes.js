const express = require('express');
const router = express.Router();
const Student = require('../../models/student/Student');
const Parent = require('../../models/parent/Parent');

// ADD A STUDENT
router.post('/', async (req, res) => {
    try {
        const { firstName, secondName, studentclass, parentDetails } = req.body;

        // Normalize input
        const normalizedFirstName = firstName.trim().toLowerCase();
        const normalizedSecondName = secondName.trim().toLowerCase();
        const normalizedClass = studentclass.trim().toLowerCase();

        // Check if the student already exists
        const existingStudent = await Student.findOne({
            firstName: normalizedFirstName,
            secondName: normalizedSecondName,
            studentclass: normalizedClass
        });

        if (existingStudent) {
            return res.status(400).json({ msg: 'Student already exists' });
        }

        // Check if parent exists
        let parent = await Parent.findOne({ phone: parentDetails.phone });

        if (!parent) {
            parent = await Parent.create({
                name: parentDetails.name,
                phone: parentDetails.phone,
                residence: parentDetails.residence,
                email: parentDetails.email,
            });
        }

        // Create and save new student
        const newStudent = await Student.create({
            firstName: normalizedFirstName,
            secondName: normalizedSecondName,
            studentclass: normalizedClass,
            parent: parent._id
        });

        res.status(201).json(newStudent);
    } catch (error) {
        console.error(error);

        if (error.code === 11000) {
            return res.status(400).json({ msg: 'Duplicate student detected (DB constraint)' });
        }

        res.status(500).json({ msg: 'Server error' });
    }
});


// UPDATE A STUDENT
router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
  
      const student = await Student.findByIdAndUpdate(id, updates, { new: true });
      if (!student) {
        return res.status(404).json({ message: 'Student not found.' });
      }
  
      res.status(200).json({ message: 'Student updated successfully.', student });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  // GET ALL STUDENTS
  router.get('/', async (req, res) => {
    try {
      const students = await Student.find().populate('parent');
      res.status(200).json(students);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
// GET A STUDENT BY ID
router.get('/:id', async (req, res) => {
    try {
        const student = await Student.findById(req.params.id).populate('parent');
        if (!student) {
            return res.status(404).json({ msg: 'Student not found' });
        }
        res.status(200).json(student);
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: 'Server error' });
    }
});
//delete a student
router.delete('/:id', async (req, res) => {
    try {
        const student = await Student.findByIdAndDelete(req.params.id);
        if (!student) {
            return res.status(404).json({ msg: 'Student not found' });
        }
        res.status(200).json({ msg: 'Student deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: 'Server error' });
    }
});

module.exports = router;
