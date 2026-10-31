import { asc, desc, eq, like, or } from "drizzle-orm";
import {
  appearanceArchives,
  marketReports,
  type InsertAppearanceArchive,
  type InsertMarketReport,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { INDUSTRY_REPORT_SEEDS } from "./industryReportSeeds";

const MARKET_REPORT_SEEDS: InsertMarketReport[] = [
  ...INDUSTRY_REPORT_SEEDS,
  {
    slug: "2026-07-component-market-monthly",
    category: "市场月报",
    title: "2026 年 7 月电子元器件行情月报：存储领涨，品类分化加剧",
    summary:
      "WSTS 最新预测与 SIA 月度数据共同显示半导体收入继续上行，但增长高度集中在存储、逻辑与 AI 基础设施。模拟、分立和传统终端需求仍需分品类判断。",
    coverTone: "blue",
    sections: [
      {
        heading: "市场总览：最新预测显著上调",
        paragraphs: [
          "WSTS 在 2026 年春季预测中将全年全球半导体市场规模上调至约 1.51 万亿美元，同比增长约 90%。这一数字明显高于 2026 年初仍被广泛引用的约 9,750 亿美元预测，反映存储价格与 AI 基础设施需求在年内快速变化。采购人员在引用行业规模时，应同时标注预测发布日期，不能把不同版本的数据视为同一口径。",
          "从品类看，WSTS 预计存储器同比增长约 250%，规模超过 8,000 亿美元；逻辑器件预计增长约 37%。微处理器、模拟器件、分立器件以及传感器和光电器件的预期增速依次约为 20%、10%、8% 和 3%，说明高增长并没有平均分布到全部元器件。",
        ],
      },
      {
        heading: "月度信号：销售额上升不等于所有型号同步涨价",
        paragraphs: [
          "SIA 公布的 WSTS 汇编数据表明，2026 年 5 月全球半导体销售额为 1,206 亿美元，较 4 月增长 9.2%，较上年同期增长 104.1%，并连续第 15 个月实现月环比增长。该数据采用三个月移动平均口径，更适合观察行业景气方向，而不能直接替代某一型号的现货成交价。",
          "当前最强需求仍来自 AI 服务器、数据中心网络与高带宽存储。传统手机、PC 和部分工业终端的复苏速度相对温和，具体型号仍可能同时出现高库存、短交期或区域性降价。站内型号行情应继续以供应商有效库存和对应数量档位报价为准。",
        ],
      },
      {
        heading: "七月采购观察",
        paragraphs: [
          "对 DRAM、NAND、HBM 及高端逻辑器件，可优先核对原厂配额、长协执行和交期变化，并对关键料设置滚动安全库存。对模拟、分立、传感器及传统 MCU，不宜因为行业总额创新高而普遍追价，应继续比较可替代型号、授权渠道现货与站内 1,000 片口径报价。",
          {
            text: "本月的核心判断是“结构性偏紧，而非全品类短缺”。采购决策应把行业销售额、合约价预测、供应商现货报价和企业实际消耗速度分开管理，避免由单一宏观数字触发过量备货。",
            mark: "key",
          },
        ],
      },
    ],
    sources: [
      { name: "WSTS · Recent News Release（Spring 2026 Forecast）", url: "https://www.wsts.org/76/Recent-News-Release" },
      { name: "SIA · Global Semiconductor Sales Increase 9.2% Month-to-Month in May", url: "https://www.semiconductors.org/global-semiconductor-sales-increase-9-2-month-to-month-in-may/" },
      { name: "Deloitte · 2026 Global Semiconductor Industry Outlook", url: "https://www.deloitte.com/us/en/insights/industry/technology/technology-media-telecom-outlooks/semiconductor-industry-outlook.html" },
    ],
    publishedAt: new Date("2026-07-15T00:00:00.000Z"),
    sortOrder: 1,
    status: "draft",
  },
  {
    slug: "2026-q3-dram-nand-procurement",
    category: "存储器",
    title: "三季度存储器采购观察：DRAM 与 NAND 涨幅放缓，高位行情延续",
    summary:
      "TrendForce 预计 2026 年第三季度传统 DRAM 合约价环比上涨 13%–18%，NAND Flash 上涨 10%–15%。涨幅较前期放缓，但服务器与 AI 需求仍使供需维持偏紧。",
    coverTone: "teal",
    sections: [
      {
        heading: "合约价继续上行，斜率开始放缓",
        paragraphs: [
          "TrendForce 在 2026 年 7 月发布的第三季度展望中预计，传统 DRAM 合约价将环比上涨 13%–18%，NAND Flash 合约价将环比上涨 10%–15%。两类产品仍处于上行周期，但涨幅较前几个季度放缓，意味着市场从快速重估逐步转向高位运行。",
          "上述预测针对合约市场，不等同于现货市场每天的成交价格，也不代表任一具体料号会按相同比例上涨。品牌、容量、制程、封装、应用等级以及长协覆盖比例都会影响实际采购结果。",
        ],
      },
      {
        heading: "服务器需求强，消费终端承压",
        paragraphs: [
          "AI 推理、大型数据中心和服务器平台仍是 NAND 与服务器 DRAM 的主要需求来源。供应商继续把部分产能向服务器和 AI 应用倾斜，压缩 PC DRAM、LPDRAM 等传统产品的供应弹性。",
          "另一方面，PC 与手机终端需求相对较弱，高价格已限制部分消费市场的承受能力。这种分化意味着服务器、网络和车载相关存储更适合提前确认交期，而消费电子料号则应同时防范高位补库后的价格回撤。",
        ],
      },
      {
        heading: "采购执行建议",
        paragraphs: [
          "对未来两至三个季度用量确定、验证周期长的服务器与网络存储，可采用分批锁量而非一次性锁满全年需求，并在合同中明确交付窗口、可接受批次和价格调整机制。对标准消费级料号，应维持多供应商询价并缩短库存周转周期。",
          "采购看板应同时跟踪原厂合约价、公开现货价、站内 1,000 片报价和企业库存覆盖天数。只有当交期拉长、报价上涨和库存下降同时出现时，才更接近真实的供应风险信号。",
        ],
      },
    ],
    sources: [
      { name: "TrendForce · 3Q26 Memory Price Outlook", url: "https://www.trendforce.com/presscenter/news/20260703-13134.html" },
      { name: "Deloitte · 2026 Global Semiconductor Industry Outlook", url: "https://www.deloitte.com/us/en/insights/industry/technology/technology-media-telecom-outlooks/semiconductor-industry-outlook.html" },
    ],
    publishedAt: new Date("2026-07-12T00:00:00.000Z"),
    sortOrder: 2,
    status: "draft",
  },
  {
    slug: "2026-h2-high-end-mlcc-risk",
    category: "被动元件",
    title: "AI 服务器推高高端 MLCC 需求：下半年交期风险上升",
    summary:
      "Murata、SEMCO 与 Taiyo Yuden 的高端 MLCC 接单指标升至疫情后高位，AI 平台所需高容量、小型化器件正在对汽车和消费级产能形成挤出效应。",
    coverTone: "amber",
    sections: [
      {
        heading: "订单指标转强，高端规格先行",
        paragraphs: [
          "TrendForce 的 2026 年下半年分析显示，截至 6 月末，Murata、SEMCO 和 Taiyo Yuden 的 Book-to-Bill 比率分别达到 1.30、1.31 和 1.25，行业整体约为 1.04。比率高于 1 表示新接订单高于当期出货，高端 MLCC 的订单积压风险正在上升。",
          "本轮需求主要集中在高容量、低电压和小型化规格。AI 加速器与服务器平台需要大量电源去耦和稳压器件，需求强度并不会平均传导到所有尺寸、容值和介质类型。",
        ],
      },
      {
        heading: "产能倾斜带来间接挤出",
        paragraphs: [
          "头部厂商把更多高端产能投入 AI 与服务器应用后，汽车和部分消费级规格的排产弹性可能下降。TrendForce 同时观察到，中国分销商在 6 月上调部分主流 X5R 消费级 MLCC 价格，平均涨幅约 15%–25%。",
          "分销端调价是风险提示，而不是全市场统一成交价。卷盘完整性、制造批次、温度特性、额定电压与认证等级差异都会造成明显价差，采购时不能只按“0603 10µF”等简化描述比价。",
        ],
      },
      {
        heading: "第四季度是重要观察窗口",
        paragraphs: [
          "下半年高端 MLCC 的交期可能继续延长，第四季度将是判断局部紧张是否扩散的重要窗口。建议对 AI 服务器、汽车电源和高可靠项目先完成 BOM 规格去重，识别真正不可替代的介质、尺寸和电压组合。",
          "对可替代规格，应同步验证两家以上原厂并保留完整卷盘标签和批次记录；对高风险规格，可在站内行情与实际询单中持续观察报价家数、可售数量和交期，而不是仅依据一次涨价通知增加全年库存。",
        ],
      },
    ],
    sources: [
      { name: "TrendForce · High-end MLCC Supply and Demand in 2H26", url: "https://www.trendforce.com/presscenter/news/20260706-13136.html" },
    ],
    publishedAt: new Date("2026-07-10T00:00:00.000Z"),
    sortOrder: 3,
    status: "draft",
  },
  {
    slug: "2026-structural-procurement-strategy",
    category: "采购策略",
    title: "2026 采购策略：高增长不等于全品类短缺",
    summary:
      "AI、存储和先进逻辑拉动行业收入快速增长，但传统终端与通用器件表现分化。采购策略需要从“全品类备货”转向按应用、替代性和追溯能力分层管理。",
    coverTone: "violet",
    sections: [
      {
        heading: "先区分收入增长与器件数量",
        paragraphs: [
          "Deloitte 指出，2026 年生成式 AI 芯片收入可能接近 5,000 亿美元，并占全球芯片销售额的重要部分，但对应的器件数量占比很低。高单价 AI 芯片和存储器可以显著推高行业收入，却不必然带动通用 MCU、模拟器件或分立器件同步短缺。",
          "PwC 的长期研究则认为，服务器/网络与汽车是增长较快的终端板块，半导体市场至 2030 年仍有望保持较高复合增长。中长期扩产与短期局部短缺可以同时存在，先进制程、封装和特定材料的约束需要单独评估。",
        ],
      },
      {
        heading: "建立四层物料策略",
        paragraphs: [
          "第一层是 AI、服务器存储和高端逻辑等供需偏紧物料，重点管理原厂配额、长协和交期；第二层是车规与高可靠器件，重点管理认证、变更通知和批次追溯；第三层是可替代的通用器件，重点推动双供、国产替代和价格竞争；第四层是长尾低频物料，重点控制呆滞库存和最小采购批量。",
          "每一层都应定义不同的安全库存、审批阈值与供应商准入规则。把所有物料使用同一个覆盖月数，会在紧缺料上留下缺口，同时在通用料上积累高价库存。",
        ],
      },
      {
        heading: "把外观与追溯纳入收货流程",
        paragraphs: [
          "行情上行期往往伴随渠道复杂度增加。收货时应核对完整料号、封装、顶标或本体标记、卷盘/管装标签、批次与条码信息，并保存可追溯记录。外观档案只能帮助初筛，不能替代授权渠道证明、电性测试或第三方鉴定。",
          "最终采购决策建议同时使用三类证据：行业报告用于判断方向，站内型号行情用于比较实时供应，企业自己的消耗和良率数据用于决定采购数量。三者相互校验，才能降低追涨、错配和来源不明物料的风险。",
        ],
      },
    ],
    sources: [
      { name: "Deloitte · 2026 Global Semiconductor Industry Outlook", url: "https://www.deloitte.com/us/en/insights/industry/technology/technology-media-telecom-outlooks/semiconductor-industry-outlook.html" },
      { name: "PwC · Semiconductor and beyond", url: "https://www.pwc.com/gx/en/1/issues/tech-data-ai/semiconductor-beyond.html" },
      { name: "WSTS · Recent News Release", url: "https://www.wsts.org/76/Recent-News-Release" },
    ],
    publishedAt: new Date("2026-07-08T00:00:00.000Z"),
    sortOrder: 4,
    status: "draft",
  },
];

const COMMON_DISCLAIMER =
  "本档案仅用于型号、包装与收货外观的初步核对，不构成真伪鉴定。不同工厂、批次和封装版本的标记可能变化；高价值物料请结合授权渠道、批次追溯、电性或第三方检测综合判断。";

const APPEARANCE_ARCHIVE_SEEDS: InsertAppearanceArchive[] = [
  {
    partNumber: "STM32F103C8T6",
    brand: "ST 意法半导体",
    category: "MCU",
    pkg: "LQFP-48",
    markingSummary: "参考样品通常可见 ST 标识、完整或分行型号、日期/批次与产地信息，Pin 1 方向点应与封装图一致。不同批次排版可能变化，应优先核对原厂包装标签和可追溯文件。",
    packagingSummary: "常见为托盘、卷带或管装，外标签应包含制造商料号、数量、批次/日期与条码等信息；本体型号、封装和标签信息应相互一致。",
    printSummary: "字符边缘、行距与深浅应在同批次内保持一致。表面异常发亮、二次涂覆、磨痕或同批字体明显混杂属于进一步核验信号，但不能单独据此判假。",
    featureTags: ["LQFP-48", "Pin 1 方向点", "批次一致性", "包装标签追溯"],
    comparisonItems: [
      { label: "本体表面", reference: "同批纹理、颜色与字符深浅相对一致", risk: "局部磨痕、涂层不均或同批外观混杂" },
      { label: "顶标信息", reference: "品牌、型号、日期/批次信息逻辑一致", risk: "型号排版异常或批次信息无法对应" },
      { label: "方向标记", reference: "Pin 1 标记位置与封装图一致", risk: "方向点模糊、位置异常或封装尺寸不符" },
      { label: "外包装", reference: "料号、数量、批次和条码可追溯", risk: "标签缺失或与本体/订单不一致" },
    ],
    officialLookupUrl: "https://www.st.com/en/microcontrollers-microprocessors/stm32f103c8.html",
    disclaimer: COMMON_DISCLAIMER,
    sortOrder: 1,
  },
  {
    partNumber: "GRM188R61A106KE69D",
    brand: "Murata 村田",
    category: "MLCC",
    pkg: "0603 / 1608M",
    markingSummary: "该尺寸 MLCC 本体通常没有可读丝印，不能依赖单颗外观确认完整料号。识别重点是卷盘标签、料带规格、端电极状态及抽样电性能。",
    packagingSummary: "常见为 7 英寸或 13 英寸卷带。卷盘标签应包含完整料号、数量、批次和条码；料带孔距、封带与方向应在整盘内一致。",
    printSummary: "核对村田品牌、完整 GRM 料号及标签条码的清晰度和一致性。二次打印、标签覆盖、信息残缺或条码无法对应订单需进一步追溯。",
    featureTags: ["本体通常无丝印", "完整卷盘标签", "端电极一致性", "抽样电测"],
    comparisonItems: [
      { label: "料带", reference: "孔距与封带连续、器件方向一致", risk: "毛边、二次封带或器件方向混乱" },
      { label: "端电极", reference: "同批色泽与覆盖范围相对一致", risk: "明显氧化、污染或镀层差异" },
      { label: "卷盘标签", reference: "完整料号、数量、批次和条码齐全", risk: "标签覆盖、重打或信息无法追溯" },
      { label: "抽样验证", reference: "容值、损耗及绝缘指标符合规格", risk: "批内离散异常或规格与标签不符" },
    ],
    officialLookupUrl: "https://www.murata.com/en-global/products/productdetail?partno=GRM188R61A106KE69D",
    disclaimer: COMMON_DISCLAIMER,
    sortOrder: 2,
  },
  {
    partNumber: "IRG4PC50UD",
    brand: "Infineon / International Rectifier",
    category: "IGBT",
    pkg: "TO-247",
    markingSummary: "参考器件应核对品牌/系列标记、型号、批次信息与封装外形。历史品牌标识可能因生产时期不同而变化，不能仅凭 Logo 版本作结论。",
    packagingSummary: "常见为管装或托盘，外标签应记录制造商料号、数量和批次。拆散包装会降低追溯能力，需要补充供应链凭证和抽样测试。",
    printSummary: "同批字符位置与深浅应相对一致；金属散热片、塑封边缘与三根引脚应无明显安装、焊接或二次整形痕迹。",
    featureTags: ["TO-247", "散热片状态", "引脚无焊接痕", "批次追溯"],
    comparisonItems: [
      { label: "引脚", reference: "镀层与长度相对一致，无使用痕迹", risk: "焊锡残留、剪脚、整形或氧化" },
      { label: "散热片", reference: "平整，安装孔与边缘无明显损伤", risk: "螺丝压痕、划痕或打磨痕" },
      { label: "塑封与标记", reference: "同批表面和字符一致", risk: "涂覆不均、字符重叠或批内混杂" },
      { label: "来源", reference: "原包装、订单与批次链条可追溯", risk: "拆散料且无法提供来源证据" },
    ],
    officialLookupUrl: "https://www.infineon.com/",
    disclaimer: COMMON_DISCLAIMER,
    sortOrder: 3,
  },
  {
    partNumber: "W25Q128JVSIQ",
    brand: "Winbond 华邦",
    category: "NOR Flash",
    pkg: "SOP-8",
    markingSummary: "参考样品应核对 Winbond 标识、型号/顶标代码、日期或批次信息及 Pin 1 方向标记。具体字符排布可能随工厂和批次变化。",
    packagingSummary: "常见为卷带或管装，标签应包含完整料号、数量、批次与条码。包装标签和器件本体应能与采购订单对应。",
    printSummary: "同批字符位置、字体和深浅应相对一致，塑封表面应无明显打磨、补涂或污染。最终应通过 JEDEC ID、容量及读写抽测确认器件功能。",
    featureTags: ["SOP-8", "Pin 1 标记", "JEDEC ID 抽测", "标签批次一致"],
    comparisonItems: [
      { label: "塑封表面", reference: "纹理和颜色在同批内相对一致", risk: "磨痕、局部补涂或异常反光" },
      { label: "顶标", reference: "品牌、代码和批次逻辑可对应", risk: "字符排版异常或同盘标记混杂" },
      { label: "Pin 1", reference: "方向点/缺口与封装图一致", risk: "方向标记模糊或位置异常" },
      { label: "功能抽测", reference: "JEDEC ID、容量及读写结果符合规格", risk: "ID、容量或读写行为异常" },
    ],
    officialLookupUrl: "https://www.winbond.com/hq/product/code-storage-flash-memory/serial-nor-flash/?__locale=en",
    disclaimer: COMMON_DISCLAIMER,
    sortOrder: 4,
  },
  {
    partNumber: "NE555DR",
    brand: "Texas Instruments",
    category: "定时器",
    pkg: "SOIC-8",
    markingSummary: "TI 小型封装的顶标可能采用短码而非完整料号。应把器件顶标、封装和完整订购料号分别记录，并使用 TI 官方 Part marking lookup 交叉查询。",
    packagingSummary: "DR 后缀通常对应卷带供货。卷盘标签应包含完整 NE555DR 料号、数量、批次/日期和条码；本体短码不能替代外包装追溯。",
    printSummary: "核对 Pin 1 方向标记、SOIC-8 外形尺寸和同批顶标一致性。不同工厂或批次的顶标代码可能变化，不应仅凭网上单张照片判断。",
    featureTags: ["TI 顶标查询", "SOIC-8", "Pin 1 标记", "卷盘标签"],
    comparisonItems: [
      { label: "顶标代码", reference: "可在 TI 官方工具中按标记或料号查询", risk: "代码无法对应且缺少原包装信息" },
      { label: "封装外形", reference: "SOIC-8 尺寸、引脚和方向标记符合规格", risk: "封装尺寸或方向标记与规格不符" },
      { label: "同批一致性", reference: "字符位置、深浅和日期/批次逻辑一致", risk: "同盘存在多种不相关标记或外观" },
      { label: "卷盘标签", reference: "完整料号、数量、批次和条码可追溯", risk: "仅有散料短码，无法对应采购来源" },
    ],
    officialLookupUrl: "https://www.ti.com/packaging/docs/partlookup.tsp",
    disclaimer: COMMON_DISCLAIMER,
    sortOrder: 5,
  },
];

let seedPromise: Promise<void> | null = null;

export function ensureDataTongContent() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      for (const report of MARKET_REPORT_SEEDS) {
        await db.insert(marketReports).values(report).onDuplicateKeyUpdate({
          set: {
            category: report.category,
            title: report.title,
            summary: report.summary,
            coverTone: report.coverTone,
            coverImageUrl: report.coverImageUrl,
            sections: report.sections,
            sources: report.sources,
            publishedAt: report.publishedAt,
            sortOrder: report.sortOrder,
            status: report.status,
          },
        });
      }
      for (const archive of APPEARANCE_ARCHIVE_SEEDS) {
        await db.insert(appearanceArchives).values(archive).onDuplicateKeyUpdate({
          set: {
            brand: archive.brand,
            category: archive.category,
            pkg: archive.pkg,
            markingSummary: archive.markingSummary,
            packagingSummary: archive.packagingSummary,
            printSummary: archive.printSummary,
            featureTags: archive.featureTags,
            comparisonItems: archive.comparisonItems,
            officialLookupUrl: archive.officialLookupUrl,
            disclaimer: archive.disclaimer,
            sortOrder: archive.sortOrder,
          },
        });
      }
    })().catch(error => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

export async function getPublishedMarketReports() {
  await ensureDataTongContent();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select()
    .from(marketReports)
    .where(eq(marketReports.status, "published"))
    .orderBy(asc(marketReports.sortOrder), desc(marketReports.publishedAt));
}

export async function getAppearanceArchives(keyword = "") {
  await ensureDataTongContent();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const normalized = keyword.trim();
  return db
    .select()
    .from(appearanceArchives)
    .where(
      normalized
        ? or(
            like(appearanceArchives.partNumber, `%${normalized}%`),
            like(appearanceArchives.brand, `%${normalized}%`),
            like(appearanceArchives.category, `%${normalized}%`)
          )
        : undefined
    )
    .orderBy(asc(appearanceArchives.sortOrder));
}

export { APPEARANCE_ARCHIVE_SEEDS, MARKET_REPORT_SEEDS };
