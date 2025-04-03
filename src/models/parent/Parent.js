const mongoose = require("mongoose");


const parentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  residence: { type: String, required: true },
  email: { type: String, required: false }, //optional

},{timestamps:true});
module.exports = mongoose.model("Parent", parentSchema);
