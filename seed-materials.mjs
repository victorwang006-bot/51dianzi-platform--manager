import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

console.log("开始填充物料演示数据...");

const materialsData = [
  ["MAT20260001", "STM32F103C8T6", "32位ARM Cortex-M3微控制器", "ST", "微控制器", "LQFP48", "72MHz主频，64KB Flash，20KB SRAM，2.0-3.6V供电，37个GPIO", "8.50", "片", "compliant", "active", "https://www.st.com/resource/en/datasheet/stm32f103c8.pdf"],
  ["MAT20260002", "W25Q128JVSIQ", "128Mbit SPI NOR Flash存储器", "Winbond", "存储器", "SOP8", "133MHz时钟，2.7-3.6V供电，10万次擦写，20年数据保持", "3.20", "颗", "compliant", "active", "https://www.winbond.com/resource-files/w25q128jv.pdf"],
  ["MAT20260003", "LM358DR", "双路运算放大器", "TI", "放大器", "SOP8", "增益带宽1MHz，3-32V单电源供电，低功耗，内部频率补偿", "0.45", "只", "compliant", "active", "https://www.ti.com/lit/ds/symlink/lm358.pdf"],
  ["MAT20260004", "ESP32-WROOM-32E", "WiFi+蓝牙双模模组", "Espressif", "无线模组", "SMD38", "双核240MHz，4MB Flash，WiFi 802.11 b/g/n，BT 4.2", "12.80", "个", "compliant", "active", "https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32e_datasheet_en.pdf"],
  ["MAT20260005", "GRM188R71H104KA93D", "0.1uF 50V X7R贴片电容", "Murata", "电容", "0603", "X7R介质，±10%容差，50V耐压，-55~+125°C", "0.03", "颗", "compliant", "active", ""],
  ["MAT20260006", "IRFZ44NPBF", "N沟道功率MOSFET", "Infineon", "分立器件", "TO-220", "55V/49A，RDS(on) 17.5mΩ，逻辑电平驱动", "1.95", "只", "compliant", "nrnd", "https://www.infineon.com/dgdl/irfz44npbf.pdf"],
  ["MAT20260007", "H27U4G8F2ETR-BC", "4Gbit SLC NAND Flash", "SK Hynix", "存储器", "TSOP48", "x8位宽，3.3V供电，页大小2KB", "6.20", "颗", "unknown", "eol", ""],
  ["MAT20260008", "AMS1117-3.3", "3.3V线性稳压器", "AMS", "电源管理", "SOT-223", "1A输出，压差1.3V@1A，输入最高15V", "0.28", "只", "compliant", "active", ""],
  ["MAT20260009", "NE555DR", "精密定时器", "TI", "时钟与定时", "SOP8", "4.5-16V供电，最高500kHz振荡频率", "0.35", "只", "compliant", "active", "https://www.ti.com/lit/ds/symlink/ne555.pdf"],
  ["MAT20260010", "ATMEGA328P-AU", "8位AVR微控制器", "Microchip", "微控制器", "TQFP32", "20MHz，32KB Flash，2KB SRAM，1.8-5.5V供电", "9.60", "片", "compliant", "active", "https://ww1.microchip.com/downloads/en/DeviceDoc/Atmel-7810-Automotive-Microcontrollers-ATmega328P_Datasheet.pdf"],
  ["MAT20260011", "MAX232DR", "RS-232收发器", "TI", "接口芯片", "SOP16", "双路驱动/接收，5V供电，内置电荷泵", "1.10", "只", "compliant", "active", ""],
  ["MAT20260012", "SN74HC595DR", "8位移位寄存器", "TI", "逻辑芯片", "SOP16", "串入并出，2-6V供电，带输出锁存", "0.42", "只", "compliant", "obsolete", ""],
];

let inserted = 0;
for (const m of materialsData) {
  const [existing] = await conn.query("SELECT id FROM materials WHERE materialNo = ?", [m[0]]);
  if (existing.length > 0) {
    console.log(`跳过已存在: ${m[0]} ${m[1]}`);
    continue;
  }
  await conn.query(
    `INSERT INTO materials (materialNo, partNumber, name, brand, category, package, description, referencePrice, unit, rohs, lifecycle, datasheetUrl, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled')`,
    m.map(v => (v === "" ? null : v)),
  );
  inserted++;
}

const [rows] = await conn.query("SELECT COUNT(*) c FROM materials");
console.log(`物料演示数据填充完成：本次插入 ${inserted} 条，表中共 ${rows[0].c} 条`);
await conn.end();
process.exit(0);
