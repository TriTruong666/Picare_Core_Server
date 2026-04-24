const { Role, Permission, User } = require("../models");

const seedRBAC = async () => {
  try {
    console.log("[SEED]: Bắt đầu khởi tạo Role và Permission...");

    // 1. Tạo Danh sách Permissions
    const permissionsData = [
      { name: "*", description: "Toàn quyền hệ thống", service: "all" },
      { name: "view_dashboard", description: "Xem dashboard", service: "oms" },
      {
        name: "manage_orders",
        description: "Quản lý đơn hàng",
        service: "oms",
      },
      { name: "view_reports", description: "Xem báo cáo", service: "oms" },
      {
        name: "access_chat",
        description: "Truy cập hệ thống chat",
        service: "chat",
      },
      { name: "manage_stock", description: "Quản lý kho", service: "oms" },
      { name: "view_orders", description: "Xem đơn hàng", service: "oms" },
      {
        name: "view_profile",
        description: "Xem profile cá nhân",
        service: "all",
      },
    ];

    const permissions = {};
    for (const p of permissionsData) {
      const [perm] = await Permission.findOrCreate({
        where: { name: p.name },
        defaults: p,
      });
      permissions[p.name] = perm;
    }

    // 2. Tạo Roles và gán Permissions
    const rolesData = [
      {
        name: "admin",
        description: "Quản trị viên tối cao",
        perms: ["*"],
      },
      {
        name: "ecom_lead",
        description: "Trưởng nhóm E-commerce",
        perms: [
          "view_dashboard",
          "manage_orders",
          "view_reports",
          "access_chat",
        ],
      },
      {
        name: "ecom_staff",
        description: "Nhân viên E-commerce",
        perms: ["view_dashboard", "manage_orders", "access_chat"],
      },
      {
        name: "warehouse",
        description: "Nhân viên kho",
        perms: ["manage_stock", "view_orders"],
      },
      {
        name: "default",
        description: "Người dùng mặc định",
        perms: ["view_profile"],
      },
    ];

    for (const r of rolesData) {
      const [role] = await Role.findOrCreate({
        where: { name: r.name },
        defaults: { name: r.name, description: r.description },
      });

      // Gán permissions cho role
      const rolePerms = r.perms.map((pName) => permissions[pName]);
      await role.setPermissions(rolePerms);
    }

    // 3. Cập nhật role_id cho các User hiện có dựa trên role string của họ
    const users = await User.findAll();
    for (const user of users) {
      const role = await Role.findOne({ where: { name: user.role } });
      if (role) {
        await user.update({ roleId: role.id });
      }
    }

    console.log("[SEED]: Hoàn tất khởi tạo RBAC!");
  } catch (error) {
    console.error("[SEED ERROR]:", error);
  }
};

module.exports = seedRBAC;
