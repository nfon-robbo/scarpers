/**
 * FIT Workout File Encoder
 * 
 * Uses the official Garmin FIT JavaScript SDK to build valid .FIT workout files
 * for import into TrainingPeaks.
 */

// @ts-ignore - Garmin SDK doesn't ship TS types
import { Encoder, Profile } from "@garmin/fitsdk";

export const WKT_STEP_DURATION: Record<string, string> = {
  TIME: "time",
  DISTANCE: "distance",
  OPEN: "open",
  REPEAT_UNTIL_STEPS_CMPLT: "repeatUntilStepsCmplt",
};

export const WKT_STEP_TARGET: Record<string, string> = {
  OPEN: "open",
  HEART_RATE: "heartRate",
  SPEED: "speed",
  POWER: "power",
};

export const INTENSITY: Record<string, string> = {
  ACTIVE: "active",
  REST: "rest",
  WARMUP: "warmup",
  COOLDOWN: "cooldown",
};

export interface WorkoutStep {
  name?: string;
  intensity: string;
  durationType: string;
  durationValue?: number; // milliseconds for time, centimeters for distance
  targetType: string;
  targetValue?: number;   // zone number for HR zones
  customTargetLow?: number;
  customTargetHigh?: number;
  // For repeat steps:
  repeatFrom?: number;
  repetitions?: number;
}

export function encodeWorkoutFit(
  workoutName: string,
  steps: WorkoutStep[]
): Uint8Array {
  const encoder = new Encoder();

  // File ID message
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "workout",
    manufacturer: 255, // Development
    product: 0,
    serialNumber: Math.floor(Date.now() / 1000),
    timeCreated: new Date(),
  });

  // Workout message
  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    wktName: workoutName.slice(0, 47),
    sport: "running",
    numValidSteps: steps.length,
  });

  // Workout Step messages
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.durationType === WKT_STEP_DURATION.REPEAT_UNTIL_STEPS_CMPLT) {
      encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
        messageIndex: i,
        durationType: "repeatUntilStepsCmplt",
        durationValue: step.repeatFrom ?? 0,
        targetType: "open",
        targetValue: step.repetitions ?? 0,
      });
    } else {
      const stepData: Record<string, unknown> = {
        messageIndex: i,
        intensity: step.intensity,
        durationType: step.durationType,
        durationValue: step.durationValue ?? 0,
        targetType: step.targetType,
        targetValue: step.targetValue ?? 0,
      };

      if (step.customTargetLow != null) {
        stepData.customTargetValueLow = step.customTargetLow;
      }
      if (step.customTargetHigh != null) {
        stepData.customTargetValueHigh = step.customTargetHigh;
      }

      encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, stepData);
    }
  }

  return encoder.close();
}
