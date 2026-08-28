import { sqliteTable, AnySQLiteColumn, uniqueIndex, text, numeric, integer, index, foreignKey, primaryKey, real } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const User = sqliteTable("User", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	phone: text(),
	passwordHash: text().notNull(),
	role: text().default("USER").notNull(),
	status: text().default("PENDING").notNull(),
	avatarUrl: text(),
	room: text(),
	gender: text(),
	emergencyContact: text(),
	theme: text().default("system").notNull(),
	language: text().default("en").notNull(),
	timezone: text().default("UTC").notNull(),
	adminNotes: text(),
	rejectionReason: text(),
	twoFactorEnabled: numeric().notNull(),
	twoFactorSecret: text(),
	twoFactorBackupCodes: text(),
	twoFactorMethod: text().default("EMAIL"),
	emailOtpCode: text(),
	emailOtpExpiresAt: numeric(),
	emailOtpAttempts: integer().default(0).notNull(),
	otpPendingToken: text(),
	otpPendingExpiresAt: numeric(),
	resetOtpHash: text(),
	resetOtpExpires: numeric(),
	institutionName: text(),
	institutionUserId: text(),
	emailVerified: numeric().notNull(),
	emailVerifyToken: text(),
	emailVerifyExpires: numeric(),
	changesRequested: text(),
	changesRequestReason: text(),
	changesRequestedAt: numeric(),
	changesRequestedBy: text(),
	lastLoginAt: numeric(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
	deletedAt: numeric(),
	deletedBy: text(),
	deletionReason: text(),
},
(table) => [
	uniqueIndex("User_otpPendingToken_key").on(table.otpPendingToken),
	uniqueIndex("User_phone_key").on(table.phone),
	uniqueIndex("User_email_key").on(table.email),
]);

export const RegistrationRequest = sqliteTable("RegistrationRequest", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	cycle: integer().default(1).notNull(),
	status: text().notNull(),
	fields: text(),
	reason: text(),
	fieldsNeedingCorrection: text(),
	reviewedBy: text(),
	reviewedAt: numeric(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("RegistrationRequest_userId_idx").on(table.userId),
]);

export const UserSession = sqliteTable("UserSession", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	token: text().notNull(),
	userAgent: text(),
	ipAddress: text(),
	expiresAt: numeric().notNull(),
	revokedAt: numeric(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("UserSession_userId_idx").on(table.userId),
	uniqueIndex("UserSession_token_key").on(table.token),
]);

export const TrustedDevice = sqliteTable("TrustedDevice", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	token: text().notNull(),
	userAgent: text(),
	ipAddress: text(),
	expiresAt: numeric().notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("TrustedDevice_expiresAt_idx").on(table.expiresAt),
	index("TrustedDevice_userId_idx").on(table.userId),
	uniqueIndex("TrustedDevice_token_key").on(table.token),
]);

export const LoginHistory = sqliteTable("LoginHistory", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	success: numeric().notNull(),
	ipAddress: text(),
	userAgent: text(),
	reason: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("LoginHistory_userId_idx").on(table.userId),
]);

export const Role = sqliteTable("Role", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	isSystem: numeric().notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("Role_name_key").on(table.name),
]);

export const Permission = sqliteTable("Permission", {
	id: text().primaryKey().notNull(),
	feature: text().notNull(),
	action: text().notNull(),
	description: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
});

export const RolePermission = sqliteTable("RolePermission", {
	roleId: text().notNull().references(() => Role.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	permissionId: text().notNull().references(() => Permission.id, { onDelete: "cascade", onUpdate: "cascade" } ),
},
(table) => [
	primaryKey({ columns: [table.roleId, table.permissionId], name: "RolePermission_roleId_permissionId_pk"})
]);

export const MealConfiguration = sqliteTable("MealConfiguration", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	displayName: text().notNull(),
	description: text(),
	icon: text().default("🍽️").notNull(),
	color: text().default("#8b5cf6").notNull(),
	mealType: text().default("REGULAR").notNull(),
	status: text().default("ACTIVE").notNull(),
	displayOrder: integer().default(0).notNull(),
	defaultState: text().default("OFF").notNull(),
	defaultVisibility: text().default("VISIBLE").notNull(),
	cutoffStrategy: text().default("SAME_DAY").notNull(),
	cutoffOffsetMinutes: integer().default(0).notNull(),
	cutoffTime: text().default("16:00").notNull(),
	startTime: text().default("08:00").notNull(),
	endTime: text().default("10:00").notNull(),
	notes: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("MealConfiguration_status_displayOrder_idx").on(table.status, table.displayOrder),
]);

export const MealEntry = sqliteTable("MealEntry", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	mealId: text().notNull().references(() => MealConfiguration.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	serviceDate: numeric().notNull(),
	status: text().default("OFF").notNull(),
	originalState: text().default("OFF").notNull(),
	editableUntil: numeric().notNull(),
	locked: numeric().notNull(),
	notes: text(),
	updatedBy: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("MealEntry_userId_mealId_serviceDate_key").on(table.userId, table.mealId, table.serviceDate),
	index("MealEntry_status_idx").on(table.status),
	index("MealEntry_mealId_serviceDate_idx").on(table.mealId, table.serviceDate),
	index("MealEntry_userId_serviceDate_idx").on(table.userId, table.serviceDate),
]);

export const MealHistory = sqliteTable("MealHistory", {
	id: text().primaryKey().notNull(),
	mealEntryId: text().notNull().references(() => MealEntry.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	mealId: text().references(() => MealConfiguration.id, { onDelete: "set null", onUpdate: "cascade" } ),
	oldStatus: text(),
	newStatus: text(),
	changedBy: text(),
	reason: text(),
	triggerSource: text().default("MANUAL").notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("MealHistory_mealEntryId_idx").on(table.mealEntryId),
]);

export const MealOverride = sqliteTable("MealOverride", {
	id: text().primaryKey().notNull(),
	mealId: text().notNull().references(() => MealConfiguration.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	userId: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	serviceDate: numeric().notNull(),
	action: text().notNull(),
	reason: text().notNull(),
	adminId: text().notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("MealOverride_mealId_serviceDate_idx").on(table.mealId, table.serviceDate),
]);

export const MealPreset = sqliteTable("MealPreset", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	isSystem: numeric().notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
});

export const MealPresetItem = sqliteTable("MealPresetItem", {
	id: text().primaryKey().notNull(),
	presetId: text().notNull().references(() => MealPreset.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	mealId: text().notNull().references(() => MealConfiguration.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	state: text().default("ON").notNull(),
});

export const LeaveApplication = sqliteTable("LeaveApplication", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	startDate: numeric().notNull(),
	endDate: numeric().notNull(),
	reason: text().notNull(),
	status: text().default("PENDING").notNull(),
	approvedBy: text(),
	mealType: text().default("ALL").notNull(),
	mealIds: text(),
	adminNotes: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("LeaveApplication_status_startDate_idx").on(table.status, table.startDate),
	index("LeaveApplication_userId_status_idx").on(table.userId, table.status),
]);

export const GuestMeal = sqliteTable("GuestMeal", {
	id: text().primaryKey().notNull(),
	mealId: text().notNull().references(() => MealConfiguration.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	userId: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	guestName: text().notNull(),
	guestCount: integer().default(1).notNull(),
	serviceDate: numeric().notNull(),
	notes: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("GuestMeal_mealId_serviceDate_idx").on(table.mealId, table.serviceDate),
]);

export const Variable = sqliteTable("Variable", {
	id: text().primaryKey().notNull(),
	key: text().notNull(),
	name: text().notNull(),
	description: text(),
	type: text().default("NUMBER").notNull(),
	value: text().notNull(),
	unit: text(),
	category: text().default("GENERAL").notNull(),
	isSystem: numeric().notNull(),
	isProtected: numeric().notNull(),
	status: text().default("ACTIVE").notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("Variable_key_key").on(table.key),
]);

export const Formula = sqliteTable("Formula", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	key: text().notNull(),
	description: text(),
	expression: text().notNull(),
	returnType: text().default("CURRENCY").notNull(),
	category: text().default("BILLING").notNull(),
	status: text().default("ACTIVE").notNull(),
	version: integer().default(1).notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("Formula_key_key").on(table.key),
]);

export const FormulaVersion = sqliteTable("FormulaVersion", {
	id: text().primaryKey().notNull(),
	formulaId: text().notNull().references(() => Formula.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	version: integer().notNull(),
	expression: text().notNull(),
	changedBy: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	changeNote: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("FormulaVersion_formulaId_version_idx").on(table.formulaId, table.version),
]);

export const BillingCycle = sqliteTable("BillingCycle", {
	id: text().primaryKey().notNull(),
	periodMonth: integer().notNull(),
	periodYear: integer().notNull(),
	status: text().default("OPEN").notNull(),
	readiness: text(),
	snapshotId: text(),
	startedBy: text(),
	startedAt: numeric(),
	closedBy: text(),
	closedAt: numeric(),
	totalExpenses: real().notNull(),
	totalMeals: integer().default(0).notNull(),
	totalGuestMeals: integer().default(0).notNull(),
	mealCharge: real().notNull(),
	billsGenerated: integer().default(0).notNull(),
	refundQueueTotal: real().notNull(),
	outstandingDue: real().notNull(),
	errorMessage: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("BillingCycle_periodMonth_periodYear_key").on(table.periodMonth, table.periodYear),
	index("BillingCycle_status_idx").on(table.status),
	uniqueIndex("BillingCycle_snapshotId_key").on(table.snapshotId),
]);

export const MonthlySnapshot = sqliteTable("MonthlySnapshot", {
	id: text().primaryKey().notNull(),
	billingCycleId: text().notNull().references(() => BillingCycle.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	mealsData: text().notNull(),
	expensesData: text().notNull(),
	variablesData: text().notNull(),
	formulaData: text().notNull(),
	totalExpenses: real().notNull(),
	totalResidentMeals: integer().notNull(),
	totalGuestMeals: integer().notNull(),
	guestRevenue: real().notNull(),
	mealCharge: real().notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("MonthlySnapshot_billingCycleId_idx").on(table.billingCycleId),
	uniqueIndex("MonthlySnapshot_billingCycleId_key").on(table.billingCycleId),
]);

export const Bill = sqliteTable("Bill", {
	id: text().primaryKey().notNull(),
	billNumber: text(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	periodMonth: integer().notNull(),
	periodYear: integer().notNull(),
	mealCharges: real().notNull(),
	otherCharges: real().notNull(),
	adjustments: real().notNull(),
	totalAmount: real().notNull(),
	paidAmount: real().notNull(),
	dueAmount: real().notNull(),
	previousDue: real().notNull(),
	status: text().default("DRAFT").notNull(),
	generatedAt: numeric(),
	dueDate: numeric(),
	snapshot: text(),
	billingCycleId: text().references(() => BillingCycle.id, { onDelete: "set null", onUpdate: "cascade" } ),
	formulaKey: text(),
	formulaVersion: integer(),
	formulaExpression: text(),
	deletedAt: numeric(),
	deletedBy: text(),
	deletionReason: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("Bill_userId_periodMonth_periodYear_key").on(table.userId, table.periodMonth, table.periodYear),
	index("Bill_billNumber_idx").on(table.billNumber),
	index("Bill_deletedAt_idx").on(table.deletedAt),
	index("Bill_status_idx").on(table.status),
]);

export const Payment = sqliteTable("Payment", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	billId: text().references(() => Bill.id, { onDelete: "set null", onUpdate: "cascade" } ),
	amount: real().notNull(),
	method: text().default("CASH").notNull(),
	status: text().default("PENDING").notNull(),
	reference: text(),
	notes: text(),
	approvedBy: text(),
	effectiveMonth: integer(),
	effectiveYear: integer(),
	deletedAt: numeric(),
	deletedBy: text(),
	deletionReason: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("Payment_effectiveMonth_effectiveYear_idx").on(table.effectiveMonth, table.effectiveYear),
	index("Payment_deletedAt_idx").on(table.deletedAt),
	index("Payment_userId_status_idx").on(table.userId, table.status),
]);

export const Expense = sqliteTable("Expense", {
	id: text().primaryKey().notNull(),
	title: text().notNull(),
	description: text(),
	category: text().default("GENERAL").notNull(),
	quantity: real().default(1).notNull(),
	unit: text().default("piece").notNull(),
	amount: real().notNull(),
	currency: text().default("INR").notNull(),
	expenseDate: numeric().notNull(),
	paidTo: text(),
	receiptUrl: text(),
	status: text().default("APPROVED").notNull(),
	createdBy: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	lockedAt: numeric(),
	lockedByCycleId: text(),
	deletedAt: numeric(),
	deletedBy: text(),
	deletionReason: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("Expense_deletedAt_idx").on(table.deletedAt),
	index("Expense_category_expenseDate_idx").on(table.category, table.expenseDate),
]);

export const Unit = sqliteTable("Unit", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	category: text().default("QUANTITY").notNull(),
	isActive: numeric().default(true).notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("Unit_name_key").on(table.name),
]);

export const Product = sqliteTable("Product", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	category: text().default("GENERAL").notNull(),
	defaultUnitId: text().references(() => Unit.id, { onDelete: "set null", onUpdate: "cascade" } ),
	isActive: numeric().default(true).notNull(),
	archivedAt: numeric(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("Product_isActive_idx").on(table.isActive),
	index("Product_category_idx").on(table.category),
	uniqueIndex("Product_slug_key").on(table.slug),
	uniqueIndex("Product_name_key").on(table.name),
]);

export const Purchase = sqliteTable("Purchase", {
	id: text().primaryKey().notNull(),
	vendor: text().notNull(),
	purchaseDate: numeric().notNull(),
	totalAmount: real().notNull(),
	receiptUrl: text(),
	notes: text(),
	expenseId: text().references(() => Expense.id, { onDelete: "set null", onUpdate: "cascade" } ),
	createdBy: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	status: text().default("APPROVED").notNull(),
	deletedAt: numeric(),
	deletedBy: text(),
	deletionReason: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("Purchase_deletedAt_idx").on(table.deletedAt),
	index("Purchase_purchaseDate_idx").on(table.purchaseDate),
	uniqueIndex("Purchase_expenseId_key").on(table.expenseId),
]);

export const PurchaseItem = sqliteTable("PurchaseItem", {
	id: text().primaryKey().notNull(),
	purchaseId: text().notNull().references(() => Purchase.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	productId: text().references(() => Product.id, { onDelete: "set null", onUpdate: "cascade" } ),
	productName: text().notNull(),
	category: text().default("GENERAL").notNull(),
	quantity: real().notNull(),
	unit: text().notNull(),
	rate: real().notNull(),
	total: real().notNull(),
	notes: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("PurchaseItem_productId_idx").on(table.productId),
	index("PurchaseItem_purchaseId_idx").on(table.purchaseId),
]);

export const Refund = sqliteTable("Refund", {
	id: text().primaryKey().notNull(),
	refundNumber: text(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	billId: text().references(() => Bill.id, { onDelete: "set null", onUpdate: "cascade" } ),
	billingCycleId: text(),
	amount: real().notNull(),
	paidAmount: real().notNull(),
	remainingAmount: real().notNull(),
	status: text().default("PENDING").notNull(),
	method: text(),
	reference: text(),
	notes: text(),
	processedBy: text(),
	processedAt: numeric(),
	completedAt: numeric(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("Refund_billingCycleId_idx").on(table.billingCycleId),
	index("Refund_userId_status_idx").on(table.userId, table.status),
]);

export const RefundTransaction = sqliteTable("RefundTransaction", {
	id: text().primaryKey().notNull(),
	refundId: text().notNull().references(() => Refund.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	amount: real().notNull(),
	method: text(),
	reference: text(),
	notes: text(),
	processedBy: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("RefundTransaction_refundId_idx").on(table.refundId),
]);

export const Adjustment = sqliteTable("Adjustment", {
	id: text().primaryKey().notNull(),
	adjustmentNumber: text(),
	userId: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	entityType: text().notNull(),
	entityId: text().notNull(),
	amount: real().notNull(),
	reason: text().notNull(),
	notes: text(),
	createdBy: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("Adjustment_entityType_entityId_idx").on(table.entityType, table.entityId),
	index("Adjustment_userId_idx").on(table.userId),
]);

export const LedgerEntry = sqliteTable("LedgerEntry", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	type: text().notNull(),
	amount: real().notNull(),
	runningBalance: real().notNull(),
	entityType: text().notNull(),
	entityId: text().references(() => Payment.id, { onDelete: "set null", onUpdate: "cascade" } ),
	description: text().notNull(),
	billingMonth: integer(),
	billingYear: integer(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("LedgerEntry_billingMonth_billingYear_idx").on(table.billingMonth, table.billingYear),
	index("LedgerEntry_entityType_entityId_idx").on(table.entityType, table.entityId),
	index("LedgerEntry_userId_createdAt_idx").on(table.userId, table.createdAt),
]);

export const Restriction = sqliteTable("Restriction", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	type: text().notNull(),
	reason: text().notNull(),
	source: text().default("AUTOMATIC").notNull(),
	status: text().default("ACTIVE").notNull(),
	appliedBy: text(),
	appliedAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	expiresAt: numeric(),
	liftedBy: text(),
	liftedAt: numeric(),
	liftReason: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("Restriction_type_status_idx").on(table.type, table.status),
	index("Restriction_userId_status_idx").on(table.userId, table.status),
]);

export const Holiday = sqliteTable("Holiday", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	type: text().default("HOLIDAY").notNull(),
	startDate: numeric().notNull(),
	endDate: numeric().notNull(),
	mealsDisabled: numeric().default(true).notNull(),
	status: text().default("ACTIVE").notNull(),
	createdBy: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("Holiday_type_status_idx").on(table.type, table.status),
	index("Holiday_startDate_endDate_idx").on(table.startDate, table.endDate),
]);

export const Notification = sqliteTable("Notification", {
	id: text().primaryKey().notNull(),
	userId: text().notNull().references(() => User.id, { onDelete: "cascade", onUpdate: "cascade" } ),
	title: text().notNull(),
	description: text(),
	type: text().default("INFO").notNull(),
	priority: text().default("NORMAL").notNull(),
	route: text(),
	readAt: numeric(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("Notification_userId_readAt_idx").on(table.userId, table.readAt),
]);

export const Announcement = sqliteTable("Announcement", {
	id: text().primaryKey().notNull(),
	title: text().notNull(),
	body: text().notNull(),
	type: text().default("INFO").notNull(),
	priority: text().default("NORMAL").notNull(),
	targetAudience: text().default("ALL").notNull(),
	isPinned: numeric().default(true).notNull(),
	status: text().default("PUBLISHED").notNull(),
	publishedAt: numeric(),
	expiresAt: numeric(),
	createdBy: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("Announcement_targetAudience_status_idx").on(table.targetAudience, table.status),
	index("Announcement_status_publishedAt_idx").on(table.status, table.publishedAt),
]);

export const AuditLog = sqliteTable("AuditLog", {
	id: text().primaryKey().notNull(),
	actorId: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	action: text().notNull(),
	entity: text().notNull(),
	entityId: text(),
	oldValue: text(),
	newValue: text(),
	ipAddress: text(),
	userAgent: text(),
	reason: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
},
(table) => [
	index("AuditLog_actorId_idx").on(table.actorId),
	index("AuditLog_entity_entityId_idx").on(table.entity, table.entityId),
]);

export const BackgroundTask = sqliteTable("BackgroundTask", {
	id: text().primaryKey().notNull(),
	type: text().notNull(),
	status: text().default("QUEUED").notNull(),
	progress: integer().default(0).notNull(),
	payload: text(),
	result: text(),
	errorMessage: text(),
	retryCount: integer().default(0).notNull(),
	maxRetries: integer().default(3).notNull(),
	scheduledFor: numeric(),
	startedAt: numeric(),
	finishedAt: numeric(),
	triggeredBy: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	index("BackgroundTask_type_status_idx").on(table.type, table.status),
	index("BackgroundTask_status_scheduledFor_idx").on(table.status, table.scheduledFor),
]);

export const StaffRecord = sqliteTable("StaffRecord", {
	id: text().primaryKey().notNull(),
	userId: text().references(() => User.id, { onDelete: "set null", onUpdate: "cascade" } ),
	name: text().notNull(),
	designation: text().notNull(),
	department: text(),
	salary: real().notNull(),
	joiningDate: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	status: text().default("ACTIVE").notNull(),
	contactNumber: text(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("StaffRecord_userId_key").on(table.userId),
]);

export const Setting = sqliteTable("Setting", {
	id: text().primaryKey().notNull(),
	key: text().notNull(),
	value: text().notNull(),
	category: text().default("GENERAL").notNull(),
	type: text().default("TEXT").notNull(),
	description: text(),
	isPublic: numeric().notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
},
(table) => [
	uniqueIndex("Setting_key_key").on(table.key),
]);

export const Institution = sqliteTable("Institution", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	type: text().default("HOSTEL").notNull(),
	address: text(),
	contactEmail: text(),
	contactPhone: text(),
	currency: text().default("INR").notNull(),
	timezone: text().default("UTC").notNull(),
	logoUrl: text(),
	isActive: numeric().default(true).notNull(),
	createdAt: numeric().default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: numeric().notNull(),
});
