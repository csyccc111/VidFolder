export type AudioTrackInfo = {
  codec?: string;
  channels?: number;
  sampleRate?: number;
  language?: string;
};

export type MediaInfo = {
  duration?: number;
  width?: number;
  height?: number;
  container?: string;
  videoCodec?: string;
  codecShortName?: string;
  containerBitrate?: number;
  videoBitrate?: number;
  bitrateEstimated?: boolean;
  frameRate?: number;
  audioTracks?: AudioTrackInfo[];
};

const CONTAINER_LABELS: Record<string, string> = {
  mov: "MOV",
  mp4: "MP4",
  m4a: "M4A",
  matroska: "Matroska",
  webm: "WebM",
  avi: "AVI",
  asf: "ASF",
  flv: "FLV",
  mpegts: "MPEG-TS",
  mpeg: "MPEG",
  mpegvideo: "MPEG",
  ogg: "OGG",
  wav: "WAV",
  w64: "W64",
  aiff: "AIFF",
  rm: "RealMedia",
  hls: "HLS",
  image2: "Image Sequence"
};

const VIDEO_CODEC_LABELS: Record<string, string> = {
  h264: "H.264",
  hevc: "H.265/HEVC",
  av1: "AV1",
  vp9: "VP9",
  vp8: "VP8",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  msmpeg4v2: "MPEG-4 v2",
  msmpeg4v3: "MPEG-4 v3",
  wmv3: "WMV3",
  vc1: "VC-1",
  theora: "Theora",
  prores: "ProRes",
  mjpeg: "MJPEG",
  huffyuv: "HuffYUV",
  ffv1: "FFV1",
  svq3: "Sorenson 3"
};

const AUDIO_CODEC_LABELS: Record<string, string> = {
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  truehd: "TrueHD",
  alac: "ALAC",
  amr_nb: "AMR-NB",
  wmav2: "WMA2",
  pcm_s16le: "PCM s16le",
  pcm_s24le: "PCM s24le",
  pcm_s32le: "PCM s32le",
  pcm_f32le: "PCM f32le"
};

/** 把 "a/b" 形式的帧率字符串转为带两位小数的 fps；0/0、负数与非法值视为未知。 */
export function parseFrameRate(avgFrameRate?: string, rFrameRate?: string): number | undefined {
  const candidates = [avgFrameRate, rFrameRate];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") continue;
    const parts = candidate.split("/");
    if (parts.length !== 2) continue;
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator <= 0) continue;
    return Math.round((numerator / denominator) * 100) / 100;
  }
  return undefined;
}

/** ffprobe 的 bit_rate 为字节/秒字符串，转为 kbps。 */
export function parseKbps(bitRate?: string): number | undefined {
  if (!bitRate || typeof bitRate !== "string") return undefined;
  const value = Number(bitRate);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round((value / 1000) * 10) / 10;
}

/** 文件大小与时长估算码率（kbps），仅当流级 bit_rate 缺失时使用。 */
export function estimateBitrateKbps(sizeBytes: number, durationSec: number): number | undefined {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || !Number.isFinite(durationSec) || durationSec <= 0) {
    return undefined;
  }
  return Math.round((sizeBytes * 8 / durationSec / 1000) * 10) / 10;
}

function formatContainer(formatName?: string, majorBrand?: string): string | undefined {
  if (!formatName || typeof formatName !== "string") return undefined;
  const aliases = formatName.split(",").map((name) => name.trim()).filter(Boolean);
  // MP4 家族 format_name 为 "mov,mp4,m4a,..." 等逗号别名，需优先匹配更具体的容器。
  const preferredOrder = ["mp4", "webm", "matroska"];
  const preferred = aliases.find((name) => preferredOrder.includes(name.toLowerCase()));
  const primary = preferred ?? aliases.find((name) => CONTAINER_LABELS[name.toLowerCase()]);
  const label = primary ? CONTAINER_LABELS[primary.toLowerCase()] : aliases[0]?.toUpperCase();
  if (!label) return undefined;
  return majorBrand ? `${label} (${majorBrand})` : label;
}

function formatVideoCodec(codecName?: string, profile?: string, level?: number): string | undefined {
  if (!codecName) return undefined;
  const label = VIDEO_CODEC_LABELS[codecName] ?? codecName.toUpperCase();
  const parts: string[] = [];
  if (profile) parts.push(profile);
  if (typeof level === "number" && Number.isFinite(level) && level > 0) {
    parts.push(`L${(level / 10).toFixed(1)}`);
  }
  return parts.length > 0 ? `${label} (${parts.join(", ")})` : label;
}

function parseAudioTrack(stream: Record<string, unknown>): AudioTrackInfo {
  const tags = (stream.tags ?? {}) as Record<string, unknown>;
  const codec = typeof stream.codec_name === "string" ? stream.codec_name : undefined;
  const language = typeof tags.language === "string" && tags.language !== "und" ? tags.language : undefined;
  return {
    codec: codec ? (AUDIO_CODEC_LABELS[codec] ?? codec.toUpperCase()) : undefined,
    channels: typeof stream.channels === "number" && Number.isFinite(stream.channels) ? stream.channels : undefined,
    sampleRate: typeof stream.sample_rate === "string" ? Number(stream.sample_rate) : undefined,
    language
  };
}

/** 解析 ffprobe -show_format -show_streams 的 JSON 输出；JSON 非法时抛错。 */
export function parseMediaInfo(stdout: string, sizeBytes?: number): MediaInfo {
  let raw: { format?: Record<string, unknown>; streams?: unknown[] };
  try {
    raw = JSON.parse(stdout) as typeof raw;
  } catch {
    throw new Error("invalid ffprobe json");
  }
  const streams = Array.isArray(raw.streams)
    ? (raw.streams as Array<Record<string, unknown>>)
    : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const format = raw.format ?? {};

  const duration =
    typeof format.duration === "string"
      ? Number(format.duration)
      : video && typeof video.duration === "string"
        ? Number(video.duration)
        : undefined;

  const rawContainerBitrate = parseKbps(typeof format.bit_rate === "string" ? format.bit_rate : undefined);
  const videoBitrate = parseKbps(video && typeof video.bit_rate === "string" ? video.bit_rate : undefined);
  // 容器级 bit_rate 缺失时用文件大小/时长估算，并标记"估算"；流级缺失不估算。
  const estimated = estimateBitrateKbps(sizeBytes ?? 0, duration ?? 0);
  const containerBitrate = rawContainerBitrate ?? estimated;
  const bitrateEstimated = rawContainerBitrate === undefined && estimated !== undefined;

  const tags = (format.tags ?? {}) as Record<string, unknown>;
  const majorBrand = typeof tags.major_brand === "string" ? tags.major_brand : undefined;

  const codecName = typeof video?.codec_name === "string" ? video.codec_name : undefined;
  return {
    duration: Number.isFinite(duration ?? NaN) ? duration : undefined,
    width: typeof video?.width === "number" ? video.width : undefined,
    height: typeof video?.height === "number" ? video.height : undefined,
    container: formatContainer(typeof format.format_name === "string" ? format.format_name : undefined, majorBrand),
    videoCodec: formatVideoCodec(codecName, typeof video?.profile === "string" ? video.profile : undefined, typeof video?.level === "number" ? video.level : undefined),
    codecShortName: codecName,
    containerBitrate,
    videoBitrate,
    bitrateEstimated,
    frameRate: parseFrameRate(
      typeof video?.avg_frame_rate === "string" ? video.avg_frame_rate : undefined,
      typeof video?.r_frame_rate === "string" ? video.r_frame_rate : undefined
    ),
    audioTracks: audioStreams.map(parseAudioTrack)
  };
}

export function formatKbpsText(kbps: number | undefined, estimated = false): string | undefined {
  if (kbps === undefined || !Number.isFinite(kbps)) return undefined;
  const value = kbps >= 1000 ? `${Math.round(kbps / 1000)} Mbps` : `${Math.round(kbps)} kbps`;
  return estimated ? `${value}（估算）` : value;
}

export function formatFrameRateText(fps: number | undefined): string | undefined {
  if (fps === undefined || !Number.isFinite(fps)) return undefined;
  return `${fps.toFixed(2).replace(/\.?0+$/, "")} fps`;
}

export function formatSampleRate(sampleRate: number | undefined): string | undefined {
  if (sampleRate === undefined || !Number.isFinite(sampleRate) || sampleRate <= 0) return undefined;
  if (sampleRate >= 1000) return `${(sampleRate / 1000).toFixed(1).replace(/\.0$/, "")}kHz`;
  return `${sampleRate}Hz`;
}

export function formatAudioTrackText(track: AudioTrackInfo): string {
  const parts: string[] = [];
  if (track.codec) parts.push(track.codec);
  if (typeof track.channels === "number" && track.channels > 0) parts.push(`${track.channels}声道`);
  const sampleRate = formatSampleRate(track.sampleRate);
  if (sampleRate) parts.push(sampleRate);
  if (track.language) parts.push(`(${track.language})`);
  return parts.length > 0 ? parts.join(" ") : "未知";
}
