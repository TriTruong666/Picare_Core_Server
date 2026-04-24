/**
 * Constant values for User Roles
 */
const UserRoles = {
  ADMIN: "admin",
  ECOM_STAFF: "ecom_staff",
  ECOM_LEAD: "ecom_lead",
  LOGISTICS: "logistics",
  WAREHOUSE: "warehouse",
  MARKETING: "marketing",
  FINANCE: "finance",
  SALE_LEAD: "sale_lead",
  SALE_STAFF: "sale_staff",
  DEFAULT: "default",
};

/**
 * Array of all allowed role strings
 */
const ROLES = Object.values(UserRoles);

module.exports = {
  UserRoles,
  ROLES,
};
