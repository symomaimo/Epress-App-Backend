const mongoose = require('mongoose')
const feesSchema = new mongoose.Schema({
student:{type:mongoose.Schema.Types.ObjectId,ref:'Student',required:true},
amountPaid:{type:Number,required:true},
datePaid:{type:Date,required:true},
paymentMethod:{type:String,required:true},
balance:{type:Number,required:false},
})
module.exports = mongoose.model('Fees',feesSchema)