const express = require('express');
const router = express.Router();
const { normalizeClass } = require("../../config/classes");

const Student = require('../../models/student/Student');
const Parent = require('../../models/parent/Parent');

const validTerm = t => ["Term1","Term2","Term3"].includes(t);

// ADD A STUDENT
router.post('/', async (req, res) => {
  try {
    const { firstName, secondName, studentclass, parentDetails, isNewAdmission, admittedYear, admittedTerm } = req.body;
    if (!firstName || !secondName || !studentclass) {
      return res.status(400).json({ msg: 'firstName, secondName, studentclass are required' });
    }

    const classLabel = normalizeClass(studentclass);
    if (!classLabel) {
      return res.status(400).json({ error: 'Invalid class. Use Playgroup, PP1, PP2, or Grade 1–9.' });
    }

    const normalizedFirstName = firstName.trim().toLowerCase();
    const normalizedSecondName = secondName.trim().toLowerCase();

    // check duplicate (name + class)
    const existingStudent = await Student.findOne({
      firstName: normalizedFirstName,
      secondName: normalizedSecondName,
      studentclass: classLabel
    });
    if (existingStudent) return res.status(400).json({ msg: 'Student already exists' });

    // optional parent upsert by phone
    let parentId = null;
    if (parentDetails?.phone) {
      const payload = {
        fullName: parentDetails.fullName || parentDetails.name || parentDetails.phone,
        phone: parentDetails.phone,
        email: parentDetails.email ?? undefined,
        address: parentDetails.address || parentDetails.residence || undefined
      };
      const parent = await Parent.findOneAndUpdate(
        { phone: payload.phone },
        { $set: { fullName: payload.fullName, email: payload.email, address: payload.address } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      parentId = parent._id;
    }

    // build doc
    const doc = {
      firstName: normalizedFirstName,
      secondName: normalizedSecondName,
      studentclass: classLabel,
      parent: parentId
    };

    // ONLY set admission fields for new intakes
    if (isNewAdmission) {
      if (!admittedYear || !validTerm(admittedTerm)) {
        return res.status(400).json({ error: 'For new admissions, provide admittedYear (e.g. 2026) and admittedTerm (Term1|Term2|Term3).' });
      }
      doc.admittedYear = Number(admittedYear);
      doc.admittedTerm = admittedTerm;
    }

    const newStudent = await Student.create(doc);
    const populatedStudent = await Student.findById(newStudent._id).populate('parent');
    res.status(201).json(populatedStudent);
  } catch (error) {
    console.error(error);
    if (error?.code === 11000) return res.status(400).json({ msg: 'Duplicate key (DB constraint)' });
    res.status(500).json({ msg: 'Server error' });
  }
});

// UPDATE A STUDENT (and parent if provided)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, secondName, studentclass, parentDetails, admittedYear, admittedTerm } = req.body;

    const student = await Student.findById(id);
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    if (firstName) student.firstName = firstName.trim().toLowerCase();
    if (secondName) student.secondName = secondName.trim().toLowerCase();

    if (studentclass) {
      const classLabel = normalizeClass(studentclass);
      if (!classLabel) return res.status(400).json({ error: 'Invalid class. Use Playgroup, PP1, PP2, or Grade 1–9.' });
      student.studentclass = classLabel;
    }

    // OPTIONAL: set admission fields (use carefully; usually only for new students)
    if (admittedYear != null || admittedTerm != null) {
      if (admittedYear != null) student.admittedYear = Number(admittedYear);
      if (admittedTerm != null) {
        if (!validTerm(admittedTerm)) return res.status(400).json({ error: 'admittedTerm must be Term1|Term2|Term3' });
        student.admittedTerm = admittedTerm;
      }
    }

    // update existing parent OR attach/create one (by phone)
    if (parentDetails) {
      if (student.parent) {
        const parent = await Parent.findById(student.parent);
        if (parent) {
          if (parentDetails.fullName || parentDetails.name) parent.fullName = parentDetails.fullName || parentDetails.name;
          if (parentDetails.phone) parent.phone = parentDetails.phone;
          if (parentDetails.email !== undefined) parent.email = parentDetails.email;
          if (parentDetails.address || parentDetails.residence) parent.address = parentDetails.address || parentDetails.residence;
          await parent.save();
        }
      } else if (parentDetails.phone) {
        const payload = {
          fullName: parentDetails.fullName || parentDetails.name || parentDetails.phone,
          phone: parentDetails.phone,
          email: parentDetails.email ?? undefined,
          address: parentDetails.address || parentDetails.residence || undefined
        };
        const parent = await Parent.findOneAndUpdate(
          { phone: payload.phone },
          { $set: { fullName: payload.fullName, email: payload.email, address: payload.address } },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        student.parent = parent._id;
      }
    }

    await student.save();
    const updatedStudent = await Student.findById(id).populate('parent');
    res.status(200).json({ message: 'Student and parent updated successfully.', student: updatedStudent });
  } catch (error) {
    console.error(error);
    if (error?.code === 11000 && error?.keyPattern?.phone) {
      return res.status(409).json({ error: 'A parent with that phone already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// GET ALL STUDENTS
router.get('/', async (_req, res) => {
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
    if (!student) return res.status(404).json({ msg: 'Student not found' });
    res.status(200).json(student);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Server error' });
  }
});

// DELETE A STUDENT
router.delete('/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    if (!student) return res.status(404).json({ msg: 'Student not found' });
    res.status(200).json({ msg: 'Student deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
