const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    secondName: { type: String, required: true },
    studentclass: { type: String, required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent' }
}, { timestamps: true });

// Compound index to prevent duplicates
StudentSchema.index({ firstName: 1, secondName: 1, studentclass: 1 }, { unique: true });

module.exports = mongoose.model('Student', StudentSchema);
