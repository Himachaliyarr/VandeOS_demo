import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { tenantModel } from "../services/tenantContext.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["SUPER_ADMIN", "HR", "EMPLOYEE", "CLIENT", "STUDENT"],
      default: "EMPLOYEE",
      required: true,
    },
    workspacePermissions: {
      type: [
        {
          type: String,
          enum: [
            "crm",
            "projects",
            "academy",
            "marketing",
            "inventory",
            "support",
            "reports",
          ],
        },
      ],
      default: undefined,
    },
    employeeId: { type: String, unique: true, sparse: true, trim: true },
    phone: { type: String, default: "" },
    title: { type: String, default: "" },
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Division",
      default: null,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
    },
    employmentType: {
      type: String,
      enum: ["FULL_TIME", "PART_TIME", "CONTRACT"],
      default: "FULL_TIME",
    },
    joinedAt: { type: Date, default: Date.now },
    remoteApproved: { type: Boolean, default: false },
    portalRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkspaceRecord",
      default: null,
    },
    mustChangePassword: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("passwordHash")) return;
  if (!this.passwordHash.startsWith("$2"))
    this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
});
userSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};
userSchema.methods.toSafeJSON = function toSafeJSON() {
  const user = this.toObject();
  delete user.passwordHash;
  return user;
};

export default tenantModel("User", userSchema);
