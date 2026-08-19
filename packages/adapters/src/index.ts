/**
 * adapters 层：协议的真实实现，core 的依赖注入在这里落地。
 *
 * 规划模块（P1~P3 逐步长出，不预建空壳）：
 * - llm/    OpenAI 兼容客户端（DeepSeek 默认，Qwen/GLM/Kimi 通吃）
 * - tts/    edge-tts / MiMo voicedesign，统一 synthesize() 接口
 * - store/  SQLite（better-sqlite3）：tracks / plays / segments / messages / memories
 * - audio/  ffmpeg loudnorm 响度归一、music-metadata 元数据读取
 * - clock/  系统时钟（可注入假时钟做测试）
 *
 * 铁律：core 永不 import 本包；只有 apps/station 在组装时注入。
 */
export {};
