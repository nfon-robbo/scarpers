/**
 * FIT Workout File Encoder
 * 
 * Builds valid .FIT workout files in the browser for import into TrainingPeaks.
 * Based on the Garmin FIT SDK specification:
 * https://developer.garmin.com/fit/cookbook/encoding-workout-files/
 */

// CRC lookup table from FIT protocol spec
const CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];

function fitCrc16(crc: number, byte: number): number {
  let tmp = CRC_TABLE[crc & 0xF];
  crc = (crc >> 4) & 0x0FFF;
  crc = crc ^ tmp ^ CRC_TABLE[byte & 0xF];
  tmp = CRC_TABLE[crc & 0xF];
  crc = (crc >> 4) & 0x0FFF;
  crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xF];
  return crc;
}

function computeCrc(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = fitCrc16(crc, data[i]);
  }
  return crc;
}

// FIT epoch: Dec 31, 1989 00:00:00 UTC
const FIT_EPOCH = new Date("1989-12-31T00:00:00Z").getTime();

function toFitTimestamp(date: Date): number {
  return Math.floor((date.getTime() - FIT_EPOCH) / 1000);
}

// Base types
const BASE_TYPE_ENUM = 0x00;    // 1 byte
const BASE_TYPE_UINT8 = 0x02;   // 1 byte
const BASE_TYPE_UINT16 = 0x84;  // 2 bytes, has endianness
const BASE_TYPE_UINT32 = 0x86;  // 4 bytes, has endianness
const BASE_TYPE_UINT32Z = 0x8C; // 4 bytes, has endianness
const BASE_TYPE_STRING = 0x07;  // 1 byte per char

// Global message numbers
const MESG_NUM_FILE_ID = 0;
const MESG_NUM_WORKOUT = 26;
const MESG_NUM_WORKOUT_STEP = 27;

// file_id fields
const FIELD_FILE_ID_TYPE = 0;           // enum
const FIELD_FILE_ID_MANUFACTURER = 1;   // uint16
const FIELD_FILE_ID_PRODUCT = 2;        // uint16
const FIELD_FILE_ID_SERIAL_NUMBER = 3;  // uint32z
const FIELD_FILE_ID_TIME_CREATED = 4;   // uint32

// workout fields
const FIELD_WORKOUT_WKT_NAME = 8;       // string
const FIELD_WORKOUT_SPORT = 4;          // enum
const FIELD_WORKOUT_SUB_SPORT = 5;      // enum
const FIELD_WORKOUT_NUM_VALID_STEPS = 6; // uint16

// workout_step fields
const FIELD_STEP_MESSAGE_INDEX = 254;    // uint16
const FIELD_STEP_WKT_STEP_NAME = 0;     // string
const FIELD_STEP_DURATION_TYPE = 1;      // enum
const FIELD_STEP_DURATION_VALUE = 2;     // uint32
const FIELD_STEP_TARGET_TYPE = 3;        // enum
const FIELD_STEP_TARGET_VALUE = 4;       // uint32
const FIELD_STEP_CUSTOM_TARGET_LOW = 5;  // uint32
const FIELD_STEP_CUSTOM_TARGET_HIGH = 6; // uint32
const FIELD_STEP_INTENSITY = 7;          // enum

// Enums
const FILE_TYPE_WORKOUT = 5;
const MANUFACTURER_DEVELOPMENT = 255;
const SPORT_RUNNING = 1;
const SUB_SPORT_INVALID = 255;

export const WKT_STEP_DURATION: Record<string, number> = {
  TIME: 0,
  DISTANCE: 1,
  OPEN: 5,
  REPEAT_UNTIL_STEPS_CMPLT: 6,
};

export const WKT_STEP_TARGET: Record<string, number> = {
  OPEN: 2,
  HEART_RATE: 1,
  SPEED: 0,
  POWER: 4,
};

export const INTENSITY: Record<string, number> = {
  ACTIVE: 0,
  REST: 1,
  WARMUP: 2,
  COOLDOWN: 3,
};

export interface WorkoutStep {
  name?: string;
  intensity: number;
  durationType: number;
  durationValue?: number; // milliseconds for time, centimeters for distance
  targetType: number;
  targetValue?: number;   // zone number for HR zones
  customTargetLow?: number;
  customTargetHigh?: number;
  // For repeat steps:
  repeatFrom?: number;
  repetitions?: number;
}

class FitBuffer {
  private chunks: Uint8Array[] = [];
  private totalSize = 0;

  writeUint8(val: number) {
    const buf = new Uint8Array(1);
    buf[0] = val & 0xFF;
    this.chunks.push(buf);
    this.totalSize += 1;
  }

  writeUint16(val: number) {
    const buf = new Uint8Array(2);
    buf[0] = val & 0xFF;
    buf[1] = (val >> 8) & 0xFF;
    this.chunks.push(buf);
    this.totalSize += 2;
  }

  writeUint32(val: number) {
    const buf = new Uint8Array(4);
    buf[0] = val & 0xFF;
    buf[1] = (val >> 8) & 0xFF;
    buf[2] = (val >> 16) & 0xFF;
    buf[3] = (val >> 24) & 0xFF;
    this.chunks.push(buf);
    this.totalSize += 4;
  }

  writeString(str: string, maxLen: number) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(str);
    const buf = new Uint8Array(maxLen);
    buf.set(encoded.slice(0, maxLen - 1));
    // Null terminated
    this.chunks.push(buf);
    this.totalSize += maxLen;
  }

  writeBytes(data: Uint8Array) {
    this.chunks.push(data);
    this.totalSize += data.length;
  }

  getSize(): number {
    return this.totalSize;
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.totalSize);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

function writeDefinitionMessage(
  buf: FitBuffer,
  localMsgType: number,
  globalMsgNum: number,
  fields: Array<[number, number, number]> // [fieldDefNum, size, baseType]
) {
  // Record header: definition message
  buf.writeUint8(0x40 | (localMsgType & 0x0F));
  // Reserved
  buf.writeUint8(0);
  // Architecture: 0 = Little Endian
  buf.writeUint8(0);
  // Global message number
  buf.writeUint16(globalMsgNum);
  // Number of fields
  buf.writeUint8(fields.length);
  // Field definitions
  for (const [fieldDefNum, size, baseType] of fields) {
    buf.writeUint8(fieldDefNum);
    buf.writeUint8(size);
    buf.writeUint8(baseType);
  }
}

function writeDataHeader(buf: FitBuffer, localMsgType: number) {
  buf.writeUint8(localMsgType & 0x0F);
}

export function encodeWorkoutFit(
  workoutName: string,
  steps: WorkoutStep[]
): Uint8Array {
  const dataBuf = new FitBuffer();
  const timestamp = toFitTimestamp(new Date());
  const nameLen = Math.min(workoutName.length + 1, 48);

  // --- File ID Definition (local msg type 0) ---
  writeDefinitionMessage(dataBuf, 0, MESG_NUM_FILE_ID, [
    [FIELD_FILE_ID_TYPE, 1, BASE_TYPE_ENUM],
    [FIELD_FILE_ID_MANUFACTURER, 2, BASE_TYPE_UINT16],
    [FIELD_FILE_ID_PRODUCT, 2, BASE_TYPE_UINT16],
    [FIELD_FILE_ID_SERIAL_NUMBER, 4, BASE_TYPE_UINT32Z],
    [FIELD_FILE_ID_TIME_CREATED, 4, BASE_TYPE_UINT32],
  ]);

  // --- File ID Data ---
  writeDataHeader(dataBuf, 0);
  dataBuf.writeUint8(FILE_TYPE_WORKOUT);     // type = workout
  dataBuf.writeUint16(MANUFACTURER_DEVELOPMENT); // manufacturer
  dataBuf.writeUint16(0);                    // product
  dataBuf.writeUint32(timestamp);            // serial number
  dataBuf.writeUint32(timestamp);            // time created

  // --- Workout Definition (local msg type 0, redefine) ---
  writeDefinitionMessage(dataBuf, 0, MESG_NUM_WORKOUT, [
    [FIELD_WORKOUT_WKT_NAME, nameLen, BASE_TYPE_STRING],
    [FIELD_WORKOUT_SPORT, 1, BASE_TYPE_ENUM],
    [FIELD_WORKOUT_SUB_SPORT, 1, BASE_TYPE_ENUM],
    [FIELD_WORKOUT_NUM_VALID_STEPS, 2, BASE_TYPE_UINT16],
  ]);

  // --- Workout Data ---
  writeDataHeader(dataBuf, 0);
  dataBuf.writeString(workoutName, nameLen);
  dataBuf.writeUint8(SPORT_RUNNING);         // sport = running
  dataBuf.writeUint8(SUB_SPORT_INVALID);     // sub_sport = invalid (generic)
  dataBuf.writeUint16(steps.length);         // num_valid_steps

  // --- Workout Step Definition (local msg type 0, redefine) ---
  writeDefinitionMessage(dataBuf, 0, MESG_NUM_WORKOUT_STEP, [
    [FIELD_STEP_MESSAGE_INDEX, 2, BASE_TYPE_UINT16],
    [FIELD_STEP_INTENSITY, 1, BASE_TYPE_ENUM],
    [FIELD_STEP_DURATION_TYPE, 1, BASE_TYPE_ENUM],
    [FIELD_STEP_DURATION_VALUE, 4, BASE_TYPE_UINT32],
    [FIELD_STEP_TARGET_TYPE, 1, BASE_TYPE_ENUM],
    [FIELD_STEP_TARGET_VALUE, 4, BASE_TYPE_UINT32],
    [FIELD_STEP_CUSTOM_TARGET_LOW, 4, BASE_TYPE_UINT32],
    [FIELD_STEP_CUSTOM_TARGET_HIGH, 4, BASE_TYPE_UINT32],
  ]);

  // --- Workout Step Data ---
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    writeDataHeader(dataBuf, 0);
    dataBuf.writeUint16(i);                            // message_index
    dataBuf.writeUint8(step.intensity);                 // intensity

    if (step.durationType === WKT_STEP_DURATION.REPEAT_UNTIL_STEPS_CMPLT) {
      dataBuf.writeUint8(WKT_STEP_DURATION.REPEAT_UNTIL_STEPS_CMPLT); // duration_type
      dataBuf.writeUint32(step.repeatFrom ?? 0);        // duration_value = step to repeat from
      dataBuf.writeUint8(WKT_STEP_TARGET.OPEN);         // target_type
      dataBuf.writeUint32(step.repetitions ?? 0);       // target_value = repeat count
      dataBuf.writeUint32(0);                           // custom low
      dataBuf.writeUint32(0);                           // custom high
    } else {
      dataBuf.writeUint8(step.durationType);             // duration_type
      dataBuf.writeUint32(step.durationValue ?? 0);      // duration_value
      dataBuf.writeUint8(step.targetType);               // target_type
      dataBuf.writeUint32(step.targetValue ?? 0);        // target_value
      dataBuf.writeUint32(step.customTargetLow ?? 0);    // custom low
      dataBuf.writeUint32(step.customTargetHigh ?? 0);   // custom high
    }
  }

  // Build the data bytes
  const dataBytes = dataBuf.toUint8Array();
  const dataSize = dataBytes.length;

  // Build file header (14 bytes)
  const header = new Uint8Array(14);
  header[0] = 14;                      // header size
  header[1] = 0x10;                    // protocol version 1.0
  header[2] = 0x4D;                    // profile version LSB (2141 = 0x085D)
  header[3] = 0x08;                    // profile version MSB
  header[4] = dataSize & 0xFF;         // data size (4 bytes, little endian)
  header[5] = (dataSize >> 8) & 0xFF;
  header[6] = (dataSize >> 16) & 0xFF;
  header[7] = (dataSize >> 24) & 0xFF;
  header[8] = 0x2E;  // '.'
  header[9] = 0x46;  // 'F'
  header[10] = 0x49; // 'I'
  header[11] = 0x54; // 'T'
  // Header CRC (bytes 12-13)
  const headerCrc = computeCrc(header.subarray(0, 12));
  header[12] = headerCrc & 0xFF;
  header[13] = (headerCrc >> 8) & 0xFF;

  // Compute file CRC over header + data
  const fileWithoutCrc = new Uint8Array(14 + dataSize);
  fileWithoutCrc.set(header, 0);
  fileWithoutCrc.set(dataBytes, 14);
  const fileCrc = computeCrc(fileWithoutCrc);

  // Final file: header + data + 2-byte CRC
  const result = new Uint8Array(14 + dataSize + 2);
  result.set(fileWithoutCrc, 0);
  result[14 + dataSize] = fileCrc & 0xFF;
  result[14 + dataSize + 1] = (fileCrc >> 8) & 0xFF;

  return result;
}
