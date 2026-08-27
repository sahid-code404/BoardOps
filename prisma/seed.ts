import { PrismaClient } from "@prisma/client";
import { hashPassword, generateToken, getTokenExpiry } from "../src/lib/auth";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding BoardOps...");

  // ── Settings (public + admin) ──
  const settings = [
    { key: "institution.name", value: "Sunrise Residency", category: "INSTITUTION", type: "TEXT", description: "Institution display name", isPublic: true },
    { key: "institution.type", value: "HOSTEL", category: "INSTITUTION", type: "TEXT", description: "Institution type", isPublic: true },
    { key: "institution.currency", value: "INR", category: "INSTITUTION", type: "TEXT", description: "Default currency code", isPublic: true },
    { key: "institution.currencySymbol", value: "₹", category: "INSTITUTION", type: "TEXT", description: "Currency symbol", isPublic: true },
    { key: "institution.timezone", value: "Asia/Kolkata", category: "INSTITUTION", type: "TEXT", isPublic: true },
    { key: "feature.autoContinueMeals", value: "true", category: "FEATURE_FLAG", type: "BOOLEAN", description: "Allow users to auto-continue meal schedule", isPublic: true },
    { key: "feature.guestMeals", value: "true", category: "FEATURE_FLAG", type: "BOOLEAN", isPublic: true },
    { key: "feature.leaveManagement", value: "true", category: "FEATURE_FLAG", type: "BOOLEAN", isPublic: true },
    { key: "billing.dueDayOfMonth", value: "10", category: "BILLING", type: "NUMBER", description: "Day of month bills are due" },
    { key: "billing.generationDayOfMonth", value: "1", category: "BILLING", type: "NUMBER", description: "Day of month bills are generated" },
    { key: "notifications.cutoffReminderMinutes", value: "60", category: "NOTIFICATIONS", type: "NUMBER", description: "Minutes before cutoff to send reminder" },
    { key: "security.passwordMinLength", value: "8", category: "SECURITY", type: "NUMBER" },
    { key: "ui.primaryColor", value: "#8b5cf6", category: "UI", type: "TEXT", isPublic: true },
  ];
  for (const s of settings) {
    await db.setting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  // ── Roles ──
  const roles = [
    { name: "ADMIN", description: "Full system access — manage users, meals, billing, settings", isSystem: true },
    { name: "USER", description: "Standard resident/user", isSystem: true },
  ];
  for (const r of roles) {
    await db.role.upsert({
      where: { name: r.name },
      update: {},
      create: r,
    });
  }

  // ── Admin user ──
  const adminEmail = "admin@boardops.io";
  const adminPass = hashPassword("Admin@123");
  const admin = await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: "Aarav Mehta",
      email: adminEmail,
      phone: "+919876543210",
      passwordHash: adminPass,
      role: "ADMIN",
      status: "ACTIVE",
      room: "Office",
      timezone: "Asia/Kolkata",
    },
  });
  // create a long-lived session for admin demo
  const token = generateToken();
  await db.userSession.create({
    data: {
      userId: admin.id,
      token,
      expiresAt: getTokenExpiry(60),
      ipAddress: "127.0.0.1",
      userAgent: "seed",
    },
  });
  console.log(`  ✅ Admin: ${adminEmail} / Admin@123  (token: ${token.slice(0, 12)}…)`);

  // ── Demo residents ──
  const residents = [
    { name: "Priya Sharma", email: "priya@boardops.io", phone: "+919876543211", room: "A-101", gender: "FEMALE" },
    { name: "Rohan Verma", email: "rohan@boardops.io", phone: "+919876543212", room: "A-102", gender: "MALE" },
    { name: "Ananya Iyer", email: "ananya@boardops.io", phone: "+919876543213", room: "B-201", gender: "FEMALE" },
    { name: "Karan Malhotra", email: "karan@boardops.io", phone: "+919876543214", room: "B-202", gender: "MALE" },
    { name: "Sneha Reddy", email: "sneha@boardops.io", phone: "+919876543215", room: "C-301", gender: "FEMALE" },
    { name: "Vikram Nair", email: "vikram@boardops.io", phone: "+919876543216", room: "C-302", gender: "MALE" },
  ];
  for (const r of residents) {
    await db.user.upsert({
      where: { email: r.email },
      update: {},
      create: {
        ...r,
        passwordHash: hashPassword("Resident@123"),
        role: "USER",
        status: "ACTIVE",
        timezone: "Asia/Kolkata",
      } as never,
    });
  }

  // ── Meal configurations (all DB-driven, not hardcoded in app logic) ──
  const meals = [
    { name: "morning", displayName: "Morning Meal", icon: "🌅", color: "#f59e0b", mealType: "REGULAR", defaultState: "ON", cutoffStrategy: "PREVIOUS_DAY", cutoffTime: "22:00", startTime: "07:00", endTime: "09:00", displayOrder: 1, description: "Light breakfast with tea" },
    { name: "lunch", displayName: "Lunch", icon: "🍛", color: "#10b981", mealType: "REGULAR", defaultState: "ON", cutoffStrategy: "SAME_DAY", cutoffTime: "10:00", startTime: "12:30", endTime: "14:00", displayOrder: 2, description: "Full vegetarian thali" },
    { name: "snacks", displayName: "Evening Snacks", icon: "🍵", color: "#06b6d4", mealType: "REGULAR", defaultState: "OFF", cutoffStrategy: "SAME_DAY", cutoffTime: "14:00", startTime: "17:00", endTime: "18:00", displayOrder: 3, description: "Tea with snacks" },
    { name: "dinner", displayName: "Dinner", icon: "🌙", color: "#8b5cf6", mealType: "REGULAR", defaultState: "ON", cutoffStrategy: "SAME_DAY", cutoffTime: "16:00", startTime: "20:00", endTime: "21:30", displayOrder: 4, description: "Full dinner" },
    { name: "festival", displayName: "Festival Special", icon: "🎉", color: "#ec4899", mealType: "FESTIVAL", defaultState: "OFF", cutoffStrategy: "PREVIOUS_DAY", cutoffTime: "20:00", startTime: "13:00", endTime: "15:00", displayOrder: 5, description: "Special festival meal (admin scheduled)" },
  ];
  for (const m of meals) {
    const existing = await db.mealConfiguration.findFirst({ where: { name: m.name } });
    if (!existing) {
      await db.mealConfiguration.create({ data: m });
    }
  }

  // ── System & custom variables ──
  const variables = [
    { key: "meal.rate.morning", name: "Morning Meal Rate", type: "CURRENCY", value: "40", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true, description: "Per-meal charge for morning meal" },
    { key: "meal.rate.lunch", name: "Lunch Rate", type: "CURRENCY", value: "60", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true },
    { key: "meal.rate.snacks", name: "Snacks Rate", type: "CURRENCY", value: "20", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true },
    { key: "meal.rate.dinner", name: "Dinner Rate", type: "CURRENCY", value: "70", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true },
    { key: "meal.rate.festival", name: "Festival Meal Rate", type: "CURRENCY", value: "120", unit: "INR", category: "MEAL_RATES", isSystem: true, isProtected: true },
    { key: "billing.roomRent", name: "Monthly Room Rent", type: "CURRENCY", value: "4500", unit: "INR", category: "BILLING", isSystem: true, isProtected: true },
    { key: "billing.securityDeposit", name: "Security Deposit", type: "CURRENCY", value: "5000", unit: "INR", category: "BILLING", isSystem: true, isProtected: true },
    { key: "billing.lateFeePercent", name: "Late Fee %", type: "PERCENTAGE", value: "2", unit: "%", category: "BILLING", isSystem: true, isProtected: true },
    { key: "billing.cleaningCharges", name: "Cleaning Charges", type: "CURRENCY", value: "150", unit: "INR", category: "BILLING", isSystem: false },
    { key: "billing.electricityPerUnit", name: "Electricity Rate / Unit", type: "CURRENCY", value: "8", unit: "INR", category: "BILLING", isSystem: false },
  ];
  for (const v of variables) {
    await db.variable.upsert({
      where: { key: v.key },
      update: {},
      create: v,
    });
  }

  // ── Formulas ──
  const formulas = [
    { name: "Meal Charges", key: "formula.mealCharges", expression: "morning_count * var('meal.rate.morning') + lunch_count * var('meal.rate.lunch') + snacks_count * var('meal.rate.snacks') + dinner_count * var('meal.rate.dinner') + festival_count * var('meal.rate.festival')", returnType: "CURRENCY", category: "BILLING" },
    { name: "Total Bill", key: "formula.totalBill", expression: "meal_charges + var('billing.roomRent') + var('billing.cleaningCharges') + adjustments", returnType: "CURRENCY", category: "BILLING" },
    { name: "Due Amount", key: "formula.dueAmount", expression: "total_amount - paid_amount", returnType: "CURRENCY", category: "BILLING" },
    { name: "Late Fee", key: "formula.lateFee", expression: "due_amount * (var('billing.lateFeePercent') / 100)", returnType: "CURRENCY", category: "BILLING" },
  ];
  for (const f of formulas) {
    const existing = await db.formula.findFirst({ where: { key: f.key } });
    if (!existing) {
      await db.formula.create({ data: { ...f, status: "ACTIVE", version: 1 } });
    }
  }

  // ── Meal presets ──
  const presets = [
    { name: "Full Meal", description: "All meals ON", items: { morning: "ON", lunch: "ON", snacks: "ON", dinner: "ON" } },
    { name: "Lunch & Dinner", description: "Only lunch and dinner", items: { morning: "OFF", lunch: "ON", snacks: "OFF", dinner: "ON" } },
    { name: "Vacation", description: "All meals OFF", items: { morning: "OFF", lunch: "OFF", snacks: "OFF", dinner: "OFF" } },
    { name: "Weekend Plan", description: "Skip morning, full lunch & dinner", items: { morning: "OFF", lunch: "ON", snacks: "ON", dinner: "ON" } },
  ];
  for (const p of presets) {
    const existing = await db.mealPreset.findFirst({ where: { name: p.name } });
    if (!existing) {
      const preset = await db.mealPreset.create({ data: { name: p.name, description: p.description, isSystem: true } });
      for (const [mealName, state] of Object.entries(p.items)) {
        const meal = await db.mealConfiguration.findFirst({ where: { name: mealName } });
        if (meal) {
          await db.mealPresetItem.create({ data: { presetId: preset.id, mealId: meal.id, state: state as string } });
        }
      }
    }
  }

  // ── Some expenses ──
  const expenses = [
    { title: "Monthly Grocery", category: "GROCERY", amount: 18500, paidTo: "FreshMart Suppliers" },
    { title: "LPG Cylinder", category: "UTILITIES", amount: 1200, paidTo: "Bharat Gas" },
    { title: "Cook Salary", category: "SALARY", amount: 12000, paidTo: "Ramesh Kumar" },
    { title: "Cleaning Supplies", category: "MAINTENANCE", amount: 850, paidTo: "CleanCo" },
    { title: "Vegetables", category: "GROCERY", amount: 3200, paidTo: "Local Vendor" },
  ];
  for (const e of expenses) {
    await db.expense.create({
      data: {
        ...e,
        currency: "INR",
        expenseDate: new Date(Date.now() - Math.random() * 7 * 86400000),
        createdBy: admin.id,
        status: "APPROVED",
      },
    });
  }

  // ── Staff ──
  const staff = [
    { name: "Ramesh Kumar", designation: "Head Cook", department: "Kitchen", salary: 12000 },
    { name: "Sunita Devi", designation: "Helper", department: "Kitchen", salary: 7000 },
    { name: "Mohan Lal", designation: "Cleaner", department: "Housekeeping", salary: 6500 },
    { name: "Rajesh Singh", designation: "Security Guard", department: "Security", salary: 9000 },
  ];
  for (const s of staff) {
    await db.staffRecord.create({ data: s });
  }

  // ── Notifications for admin ──
  await db.notification.create({
    data: {
      userId: admin.id,
      title: "Welcome to BoardOps",
      description: "Your operations suite is ready. Explore the dashboard, configure meals, and review variables.",
      type: "SUCCESS",
      priority: "HIGH",
      route: "dashboard",
    },
  });
  await db.notification.create({
    data: {
      userId: admin.id,
      title: "3 new registrations pending",
      description: "Review and approve pending user accounts.",
      type: "INFO",
      priority: "NORMAL",
      route: "users",
    },
  });
  await db.notification.create({
    data: {
      userId: admin.id,
      title: "Monthly bills generated",
      description: "Bills for the current period have been auto-calculated.",
      type: "SUCCESS",
      priority: "NORMAL",
      route: "billing",
    },
  });

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
