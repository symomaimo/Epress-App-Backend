const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
    studentclass: { type: String, required: true },
    fees: { type: Number, required: true },

})
module.exports = mongoose.model('Class', classSchema)