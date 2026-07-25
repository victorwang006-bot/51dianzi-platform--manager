# 前台直连 RDS 读取物料数据——对接说明

> 交付对象：51电子网前台开发任务
> 出具方：后台管理系统（dianzi51-admin）
> 日期：2026-07-25

## 一、结论与架构约定

前台网站的物料查询（型号搜索、规格参数、规格书链接）**直接只读连接后台 RDS 数据库的 `materials` 表**，不经过后台 HTTP API。该方案已在生产环境运行验证，相比调用 API 减少一跳 HTTP 往返，内网查询延迟为毫秒级。

架构分工约定如下：

| 角色 | 职责 |
|---|---|
| 后台管理系统 | 物料数据的唯一写入/维护入口（新增、编辑、启停、导入、上传规格书） |
| 前台网站 | 只读查询 `materials` 表；**禁止任何 INSERT/UPDATE/DELETE** |
| RDS | 数据唯一存储；OSS 仅存放图片、PDF 等静态文件 |

## 二、连接信息

通过环境变量 `ADMIN_DB_URL` 注入连接串（生产 ECS 上 `/opt/apps/dianzi51-platform/ecosystem.config.cjs` 已配置，可直接复用）：

```
ADMIN_DB_URL=mysql://RDS_51dianzi:<密码>@rm-bp1m856i4zowwc264.mysql.rds.aliyuncs.com:3306/dianzi51_admin
```

连接要求：

1. 使用连接池（建议 connectionLimit 3~10），启用 TLS（`minVersion: TLSv1.2`）。
2. 连接串只允许存放在服务器端环境变量，严禁进入前端浏览器代码或 Git 仓库。
3. RDS 白名单已放行 ECS（47.97.108.147）内网 IP；新增服务器需先加白名单。

## 三、materials 表结构（只读关注字段）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | 自增主键 |
| materialNo | varchar | 物料编号（唯一，如 MAT20260084） |
| partNumber | varchar | 制造商型号（查询主键，如 STM32F103C8T6），已建索引 |
| name | varchar | 物料名称/描述 |
| brand | varchar | 品牌（如 ST） |
| category | varchar | 分类（如 单片机(MCU/MPU/SOC)） |
| package | varchar | 封装（注意是保留字，SQL 中需反引号 \`package\`） |
| description | text | 详细描述 |
| specs | json | 规格参数键值对（26 项选型参数） |
| datasheetUrl | varchar | 规格书链接（ST 官网产品页或平台 PDF） |
| coverImageUrl / images | varchar / json | 封面图与图集（可能为空） |
| lifecycle | varchar | 生命周期（active/nrnd/eol 等） |
| rohs | varchar | RoHS 状态（compliant 等） |
| status | enum | **enabled/disabled，前台必须只查 enabled** |
| updatedAt | timestamp | 更新时间 |

当前数据量 510 条（STM32F 全系列选型表）。已建索引：PRIMARY(id)、UNIQUE(materialNo)、idx_materials_partNumber(partNumber)、idx_materials_status_category(status, category)，支撑 10 万+ 数据量无需再改。

## 四、标准查询 SQL（三个场景）

所有查询必须带 `status = 'enabled'` 条件，这是后台控制前台可见性的开关。

**1. 型号模糊搜索（前缀优先排序）**

```sql
SELECT id, partNumber, name, brand, category, `package`
FROM materials
WHERE status = 'enabled' AND (partNumber LIKE 'STM32F1%' OR partNumber LIKE '%STM32F1%')
ORDER BY (partNumber LIKE 'STM32F1%') DESC, partNumber ASC
LIMIT 20;
```

**2. 精确取单个型号完整参数**

```sql
SELECT id, partNumber, name, brand, category, `package`, description,
       specs, datasheetUrl, lifecycle, rohs
FROM materials
WHERE status = 'enabled' AND UPPER(partNumber) = UPPER('stm32f103c8t6')
LIMIT 1;
```

**3. 批量取参数（BOM 配单场景，单条 IN 查询）**

```sql
SELECT partNumber, name, brand, specs, datasheetUrl
FROM materials
WHERE status = 'enabled' AND UPPER(partNumber) IN ('STM32F103C8T6', 'STM32F407VGT6');
```

`specs` 字段取出后为 JSON 字符串或对象，需做一次 `JSON.parse` 容错处理（解析失败回退空对象）。

## 五、缓存与降级建议（前台已实现，供参考）

1. **内存缓存**：同一型号的参数结果缓存 10 分钟，减少重复查询；缓存条目超过 2000 时整体清空。
2. **降级回退**：直连不可用时（连接池创建失败），回退调用后台公开 HTTP API：`GET http://47.97.108.147/admin/api/trpc/material.search`、`material.lookup`、`material.getSpecs`（公开接口，无需鉴权）。
3. **数据时效认知**：后台改动数据后，前台最迟 10 分钟（缓存过期）生效；如需立即生效可重启前台进程清缓存。

## 六、红线约定

1. 前台对 `dianzi51_admin` 库**只读**，任何写操作（含建表、改表）必须由后台方执行。
2. 不得依赖本说明未列出的字段；后台若调整表结构会提前知会前台方。
3. 连接凭证泄露或需要轮换时，联系后台方在 RDS 控制台重置并同步更新两侧 ecosystem 配置。
