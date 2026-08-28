import { relations } from "drizzle-orm/relations";
import { User, RegistrationRequest, UserSession, TrustedDevice, LoginHistory, Permission, RolePermission, Role, MealConfiguration, MealEntry, MealHistory, MealOverride, MealPresetItem, MealPreset, LeaveApplication, GuestMeal, FormulaVersion, Formula, BillingCycle, MonthlySnapshot, Bill, Payment, Expense, Unit, Product, Purchase, PurchaseItem, Refund, RefundTransaction, Adjustment, LedgerEntry, Restriction, Notification, Announcement, AuditLog, BackgroundTask, StaffRecord } from "./schema";

export const RegistrationRequestRelations = relations(RegistrationRequest, ({one}) => ({
	User: one(User, {
		fields: [RegistrationRequest.userId],
		references: [User.id]
	}),
}));

export const UserRelations = relations(User, ({many}) => ({
	RegistrationRequests: many(RegistrationRequest),
	UserSessions: many(UserSession),
	TrustedDevices: many(TrustedDevice),
	LoginHistories: many(LoginHistory),
	MealEntries: many(MealEntry),
	MealOverrides: many(MealOverride),
	LeaveApplications: many(LeaveApplication),
	GuestMeals: many(GuestMeal),
	FormulaVersions: many(FormulaVersion),
	Bills: many(Bill),
	Payments: many(Payment),
	Expenses: many(Expense),
	Purchases: many(Purchase),
	Refunds: many(Refund),
	Adjustments_createdBy: many(Adjustment, {
		relationName: "Adjustment_createdBy_User_id"
	}),
	Adjustments_userId: many(Adjustment, {
		relationName: "Adjustment_userId_User_id"
	}),
	LedgerEntries: many(LedgerEntry),
	Restrictions: many(Restriction),
	Notifications: many(Notification),
	Announcements: many(Announcement),
	AuditLogs: many(AuditLog),
	BackgroundTasks: many(BackgroundTask),
	StaffRecords: many(StaffRecord),
}));

export const UserSessionRelations = relations(UserSession, ({one}) => ({
	User: one(User, {
		fields: [UserSession.userId],
		references: [User.id]
	}),
}));

export const TrustedDeviceRelations = relations(TrustedDevice, ({one}) => ({
	User: one(User, {
		fields: [TrustedDevice.userId],
		references: [User.id]
	}),
}));

export const LoginHistoryRelations = relations(LoginHistory, ({one}) => ({
	User: one(User, {
		fields: [LoginHistory.userId],
		references: [User.id]
	}),
}));

export const RolePermissionRelations = relations(RolePermission, ({one}) => ({
	Permission: one(Permission, {
		fields: [RolePermission.permissionId],
		references: [Permission.id]
	}),
	Role: one(Role, {
		fields: [RolePermission.roleId],
		references: [Role.id]
	}),
}));

export const PermissionRelations = relations(Permission, ({many}) => ({
	RolePermissions: many(RolePermission),
}));

export const RoleRelations = relations(Role, ({many}) => ({
	RolePermissions: many(RolePermission),
}));

export const MealEntryRelations = relations(MealEntry, ({one, many}) => ({
	MealConfiguration: one(MealConfiguration, {
		fields: [MealEntry.mealId],
		references: [MealConfiguration.id]
	}),
	User: one(User, {
		fields: [MealEntry.userId],
		references: [User.id]
	}),
	MealHistories: many(MealHistory),
}));

export const MealConfigurationRelations = relations(MealConfiguration, ({many}) => ({
	MealEntries: many(MealEntry),
	MealHistories: many(MealHistory),
	MealOverrides: many(MealOverride),
	MealPresetItems: many(MealPresetItem),
	GuestMeals: many(GuestMeal),
}));

export const MealHistoryRelations = relations(MealHistory, ({one}) => ({
	MealConfiguration: one(MealConfiguration, {
		fields: [MealHistory.mealId],
		references: [MealConfiguration.id]
	}),
	MealEntry: one(MealEntry, {
		fields: [MealHistory.mealEntryId],
		references: [MealEntry.id]
	}),
}));

export const MealOverrideRelations = relations(MealOverride, ({one}) => ({
	User: one(User, {
		fields: [MealOverride.userId],
		references: [User.id]
	}),
	MealConfiguration: one(MealConfiguration, {
		fields: [MealOverride.mealId],
		references: [MealConfiguration.id]
	}),
}));

export const MealPresetItemRelations = relations(MealPresetItem, ({one}) => ({
	MealConfiguration: one(MealConfiguration, {
		fields: [MealPresetItem.mealId],
		references: [MealConfiguration.id]
	}),
	MealPreset: one(MealPreset, {
		fields: [MealPresetItem.presetId],
		references: [MealPreset.id]
	}),
}));

export const MealPresetRelations = relations(MealPreset, ({many}) => ({
	MealPresetItems: many(MealPresetItem),
}));

export const LeaveApplicationRelations = relations(LeaveApplication, ({one}) => ({
	User: one(User, {
		fields: [LeaveApplication.userId],
		references: [User.id]
	}),
}));

export const GuestMealRelations = relations(GuestMeal, ({one}) => ({
	User: one(User, {
		fields: [GuestMeal.userId],
		references: [User.id]
	}),
	MealConfiguration: one(MealConfiguration, {
		fields: [GuestMeal.mealId],
		references: [MealConfiguration.id]
	}),
}));

export const FormulaVersionRelations = relations(FormulaVersion, ({one}) => ({
	User: one(User, {
		fields: [FormulaVersion.changedBy],
		references: [User.id]
	}),
	Formula: one(Formula, {
		fields: [FormulaVersion.formulaId],
		references: [Formula.id]
	}),
}));

export const FormulaRelations = relations(Formula, ({many}) => ({
	FormulaVersions: many(FormulaVersion),
}));

export const MonthlySnapshotRelations = relations(MonthlySnapshot, ({one}) => ({
	BillingCycle: one(BillingCycle, {
		fields: [MonthlySnapshot.billingCycleId],
		references: [BillingCycle.id]
	}),
}));

export const BillingCycleRelations = relations(BillingCycle, ({many}) => ({
	MonthlySnapshots: many(MonthlySnapshot),
	Bills: many(Bill),
}));

export const BillRelations = relations(Bill, ({one, many}) => ({
	BillingCycle: one(BillingCycle, {
		fields: [Bill.billingCycleId],
		references: [BillingCycle.id]
	}),
	User: one(User, {
		fields: [Bill.userId],
		references: [User.id]
	}),
	Payments: many(Payment),
	Refunds: many(Refund),
}));

export const PaymentRelations = relations(Payment, ({one}) => ({
	Bill: one(Bill, {
		fields: [Payment.billId],
		references: [Bill.id]
	}),
	User: one(User, {
		fields: [Payment.userId],
		references: [User.id]
	}),
}));

export const ExpenseRelations = relations(Expense, ({one, many}) => ({
	User: one(User, {
		fields: [Expense.createdBy],
		references: [User.id]
	}),
	Purchases: many(Purchase),
}));

export const ProductRelations = relations(Product, ({one, many}) => ({
	Unit: one(Unit, {
		fields: [Product.defaultUnitId],
		references: [Unit.id]
	}),
	PurchaseItems: many(PurchaseItem),
}));

export const UnitRelations = relations(Unit, ({many}) => ({
	Products: many(Product),
}));

export const PurchaseRelations = relations(Purchase, ({one, many}) => ({
	User: one(User, {
		fields: [Purchase.createdBy],
		references: [User.id]
	}),
	Expense: one(Expense, {
		fields: [Purchase.expenseId],
		references: [Expense.id]
	}),
	PurchaseItems: many(PurchaseItem),
}));

export const PurchaseItemRelations = relations(PurchaseItem, ({one}) => ({
	Product: one(Product, {
		fields: [PurchaseItem.productId],
		references: [Product.id]
	}),
	Purchase: one(Purchase, {
		fields: [PurchaseItem.purchaseId],
		references: [Purchase.id]
	}),
}));

export const RefundRelations = relations(Refund, ({one, many}) => ({
	Bill: one(Bill, {
		fields: [Refund.billId],
		references: [Bill.id]
	}),
	User: one(User, {
		fields: [Refund.userId],
		references: [User.id]
	}),
	RefundTransactions: many(RefundTransaction),
}));

export const RefundTransactionRelations = relations(RefundTransaction, ({one}) => ({
	Refund: one(Refund, {
		fields: [RefundTransaction.refundId],
		references: [Refund.id]
	}),
}));

export const AdjustmentRelations = relations(Adjustment, ({one}) => ({
	User_createdBy: one(User, {
		fields: [Adjustment.createdBy],
		references: [User.id],
		relationName: "Adjustment_createdBy_User_id"
	}),
	User_userId: one(User, {
		fields: [Adjustment.userId],
		references: [User.id],
		relationName: "Adjustment_userId_User_id"
	}),
}));

export const LedgerEntryRelations = relations(LedgerEntry, ({one}) => ({
	User: one(User, {
		fields: [LedgerEntry.userId],
		references: [User.id]
	}),
}));

export const RestrictionRelations = relations(Restriction, ({one}) => ({
	User: one(User, {
		fields: [Restriction.userId],
		references: [User.id]
	}),
}));

export const NotificationRelations = relations(Notification, ({one}) => ({
	User: one(User, {
		fields: [Notification.userId],
		references: [User.id]
	}),
}));

export const AnnouncementRelations = relations(Announcement, ({one}) => ({
	User: one(User, {
		fields: [Announcement.createdBy],
		references: [User.id]
	}),
}));

export const AuditLogRelations = relations(AuditLog, ({one}) => ({
	User: one(User, {
		fields: [AuditLog.actorId],
		references: [User.id]
	}),
}));

export const BackgroundTaskRelations = relations(BackgroundTask, ({one}) => ({
	User: one(User, {
		fields: [BackgroundTask.triggeredBy],
		references: [User.id]
	}),
}));

export const StaffRecordRelations = relations(StaffRecord, ({one}) => ({
	User: one(User, {
		fields: [StaffRecord.userId],
		references: [User.id]
	}),
}));
