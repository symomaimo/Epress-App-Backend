const mongoose = require("mongoose");
const studentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  secondName: { type: String, required: true },
  studentclass: { type: String, required: true },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Parent",
    required: true,
  },

});
module.exports = mongoose.model("Student", studentSchema);
