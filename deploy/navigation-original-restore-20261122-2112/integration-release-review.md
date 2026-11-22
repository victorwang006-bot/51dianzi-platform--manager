# 独立本地发布前有限复核

**结果：PASS**。范围：`navigation-original-restore-release-20261122-2112`。仅本地读取和必要复核脚本/报告写入，未 SSH、联网、发布、业务调用、secret 读取、源码改写或 Git 修改；未重复全站 build/tsc。

- 精确 manifest SHA-256：`40e6c3813af3802668b7ccc8fc33ff3663be248f8e21352141b1842aec6e1ed0`
- HTML SHA-256：`de7ad8f0890c342920ac8ab2835be62ccd6e395a410d792dc38bd30cf90511d0`
- 冻结源码：`684552d91d504029e867808c65bd057822a8992c`

## 检查

- PASS — `dashboard_exact_three_patches_fullbyte_inverse_outside`
- PASS — `dashboard_three_siblings_all_nonaccount_props_logo_account_exact`
- PASS — `NI_import_init_provider_native_react_jsx_singletons_unchanged`
- PASS — `HTML_only_dashboard_mapping_copied_scope_one_css_href_inverse_exact`
- PASS — `new_dashboard_every_literal_import_same_resolution_except_one_installed_factory`
- PASS — `pure_factory_only_eight_navigation_sources_no_new_layout_no_bundled_business_react_query_trpc`
- PASS — `exact_final_three_assets_and_expected_HTML_hash`
- PASS — `frozen_commit_all_pins_and_original_navigation_baseline`
- PASS — `CSS_exact_4074_byte_fixedHeader_suffix_removal_base_Status_preserved_inverse`
- PASS — `fresh_four_captured_targets_only_adminHTML_change_existing_business_references_retained`
- PASS — `recorded_true_three_sibling_native_53CSS_4viewport_geometry_routes_levels_zero_network`
- PASS — `publisher_client_and_remote_scope_owner_dual_lock_immutable_assets_guards_CAS_close`
- PASS — `manifest_unchanged_during_independent_review`

三 JS/CSS 资产 bytes/SHA、冻结 pins、原导航基线、Dashboard 三补丁和完整账号、NI/native React/JSX、HTML importmap/scopes/单 CSS href 与 full-byte inverse 均做独立重算。CSS 仅移去 4074-byte fixedHeader 后缀，原 baseCSS 和 Status 删除保留，不追加覆盖。几何仅复核既有离线报告及其 53 层 CSS pins，不重新连接生产或执行浏览器；四视口与 78/0/99+、原层级/销售来源及 860 组织菜单可达证据与定向脚本一致。

发布 client/remote 仅静态审查：双锁、scope/owner、三资产 allowlist、fresh captured 12-process guard、仅 admin HTML 可变的四 targets、空 API/runtime、无 reload/业务 RPC、不可覆盖旧 assets、CAS、0700/0600 durable backup、验证和持久关闭/失败持锁逻辑。未执行，也未宣称此刻生产锁/基线已通过；执行方仍须按既有 client 做 fresh 校验。脚本含未调用的历史业务 RPC helper，但它们不在发布入口可达调用图。

## 夹具修正与限制

补捕既存 lazyDashboard baseCSS，以及零值状态自然宽度至少 3 种阈值修正，均属于离线夹具/证据修正，不是业务源码修复，不改变发布三资产范围。真实账号、客户业务/SQL、真实未读读取与标记写入不是此轮验证；503 仍 **OPEN**，未宣称根因关闭。platform 不部署。
