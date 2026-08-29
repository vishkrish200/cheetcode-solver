export type NetworkRecordType = "http" | "websocket";

export interface NetworkRecord {
  id: string;
  type: NetworkRecordType;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  requestPostData?: string;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBodyPreview?: string;
  responseBodyBase64?: string;
  responseBodyBytes?: number;
  bodyTruncated?: boolean;
  failureText?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  framesSent?: number;
  framesReceived?: number;
  webSocketFrames?: WebSocketFrameRecord[];
}

export interface WebSocketFrameRecord {
  direction: "sent" | "received";
  at: string;
  opcode?: number;
  payloadPreview?: string;
  payloadBase64?: string;
  payloadBytes: number;
  truncated?: boolean;
}

export interface EndpointSummary {
  key: string;
  count: number;
  methods: string[];
  statuses: number[];
  resourceTypes: string[];
  contentTypes: string[];
  tags: string[];
  sampleUrls: string[];
  sampleRequestPostData?: string;
  sampleResponseBodyPreview?: string;
}

export interface RunMetadata {
  command: "auth" | "cold" | "sacrifice";
  targetUrl: string;
  runDir: string;
  startedAt: string;
  finishedAt?: string;
  finalUrl?: string;
  title?: string;
  notes?: string[];
}
