const mongoose = require('mongoose');

const usageLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    serviceType: {
      type: String,
      enum: ['video_upload', 'image_upload', 'url_paste'],
      required: true,
      index: true,
    },
    fileName: {
      type: String,
      default: null,
    },
    pastedUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UsageLog', usageLogSchema);
