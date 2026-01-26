import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const degreeSchema = new Schema(
  {
    title: { type: String, trim: true, required: true },
    institute: { type: String, trim: true },
    year: { type: Number },
  },
  { _id: false },
);

const slotSchema = new Schema(
  {
    start: { type: String, required: true, match: timeRegex },
    end: { type: String, required: true, match: timeRegex },
  },
  { _id: false },
);

const dayScheduleSchema = new Schema(
  {
    day: { type: String, enum: DAYS, required: true },
    isActive: { type: Boolean, default: false },
    slots: { type: [slotSchema], default: [] },
  },
  { _id: false },
);

const dependentSchema = new Schema({
  fullName: { type: String, trim: true, required: true },
  relationship: { type: String, trim: true },
  gender: { type: String, trim: true },
  dob: { type: Date },
  phone: { type: String, trim: true },
  notes: { type: String, trim: true, maxlength: 500 },
  isActive: { type: Boolean, default: true },
});

const userSchema = new Schema(
  {
    fullName: { type: String, trim: true, required: true },

    email: { type: String, trim: true, unique: true },

    password: { type: String, select: false },

    username: { type: String, trim: true },

    phone: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    experienceYears: { type: Number, default: 0, min: 0 },

    address: { type: String, trim: true },

    // Doctor fields
    specialty: { type: String, trim: true },
    specialties: [{ type: String, trim: true }],

    medicalLicenseNumber: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    bio: { type: String, maxlength: 500 },

    degrees: { type: [degreeSchema], default: [] },

    fees: {
      amount: { type: Number, default: 0, min: 0 },
      currency: { type: String, default: "USD", trim: true },
    },

    visitingHoursText: { type: String, trim: true },

    weeklySchedule: { type: [dayScheduleSchema], default: [] },

    // ✅ NEW: Video call availability for doctors
    isVideoCallAvailable: {
      type: Boolean,
      default: false,
      description: "Whether doctor offers video consultation",
    },

    // gender: {
    //   type: String,
    //   enum: [
    //     "male",
    //     "female",
    //     "non-binary",
    //     "trans man",
    //     "trans woman",
    //     "other",
    //     "prefer not to say",
    //   ],
    // },

    selfDescription: { type: String, maxlength: 1000 },

    dob: { type: Date },

    // height: { type: String },

    // sexualOrientation: {
    //   type: String,
    //   enum: ["man", "woman", "prefer not to say"],
    // },

    // personalityType: {
    //   type: String,
    //   enum: [
    //     "INTJ","INTP","INFJ","INFP","ISTJ","ISTP","ISFJ","ISFP",
    //     "ENTJ","ENTP","ENFJ","ENFP","ESTJ","ESTP","ESFJ","ESFP",
    //   ],
    // },

    // religion: {
    //   type: String,
    //   enum: [
    //     "agnostic","atheist","buddhist","catholic","christian","hindu",
    //     "jewish","muslim","spiritual","prefer not to say",
    //   ],
    // },

    // lookingFor: [
    //   {
    //     type: String,
    //     enum: [
    //       "something casual",
    //       "friends",
    //       "friends with benefits",
    //       "one night stand",
    //       "long term dating",
    //       "short term dating",
    //       "i don't know yet",
    //       "vibe",
    //     ],
    //   },
    // ],

    interests: [{ type: String, maxlength: 100 }],

    avatar: {
      public_id: { type: String, default: "" },
      url: { type: String, default: "" },
    },

    profilePhotos: [
      {
        public_id: { type: String, required: true },
        url: { type: String, required: true },
      },
    ],

    // Simple lat/lng strings
    location: {
      lat: { type: String, default: null },
      lng: { type: String, default: null },
      updatedAt: { type: Date, default: Date.now() },
    },

    addresses: { type: Array, default: [] },

    notifications: { type: Boolean, default: true },

    language: { type: String, default: "en" },

    country: { type: String, default: "" },

    referralCode: {
      type: String,
      default: () => Math.random().toString(36).substr(2, 9).toUpperCase(),
    },

    registrationReferralCode: { type: String, trim: true },

    dependents: { type: [dependentSchema], default: [] },

    // ✅ ONLY roles
    role: {
      type: String,
      enum: ["patient", "doctor", "admin"],
      default: "patient",
    },

    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    // verificationInfo: {
    //   verified: { type: Boolean, default: false },
    //   token: { type: String, default: "" },
    // },

    password_reset_token: { type: String, default: "" },

    // fine: { type: Number, default: 0 },

    refreshToken: { type: String, default: "" },

    // FCM device tokens for push notifications
    fcmTokens: [
      {
        token: { type: String, required: true },
        platform: {
          type: String,
          enum: ["android", "ios", "web"],
          required: true,
        },
        createdAt: { type: Date, default: Date.now },
        isActive: { type: Boolean, default: true },
      },
    ],

    review: [
      {
        rating: {
          type: Number,
          min: [0, "Rating cannot be negative"],
          max: [5, "Rating cannot exceed 5"],
          default: 0,
        },
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        text: { type: String },
      },
    ],
  },
  { timestamps: true },
);

userSchema.pre("save", async function (next) {
  if (this.isModified("password") && this.password) {
    const saltRounds = Number(process.env.bcrypt_salt_round) || 10;
    this.password = await bcrypt.hash(this.password, saltRounds);
  }

  if (this.isModified("addresses") && Array.isArray(this.addresses)) {
    let defaultFound = false;
    this.addresses = this.addresses.map((addr) => {
      if (addr?.isDefault) {
        if (!defaultFound) {
          defaultFound = true;
          return addr;
        }
        addr.isDefault = false;
      }
      return addr;
    });
  }

  if (this.isModified("weeklySchedule") && Array.isArray(this.weeklySchedule)) {
    for (const d of this.weeklySchedule) {
      if (!d?.isActive) continue;
      for (const s of d.slots || []) {
        if (s.start >= s.end) {
          return next(
            new Error(`Invalid slot on ${d.day}: start must be < end`),
          );
        }
      }
    }
  }

  next();
});

userSchema.statics.isUserExistsByEmail = async function (email) {
  return await this.findOne({ email }).select("+password");
};

userSchema.statics.isPasswordMatched = async function (
  plainTextPassword,
  hashPassword,
) {
  return await bcrypt.compare(plainTextPassword, hashPassword);
};

userSchema.statics.findByPhone = async function (phone) {
  return await this.findOne({ phone });
};

export const User = mongoose.model("User", userSchema);
