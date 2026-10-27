export interface SharpenerOptions {
  enabled: boolean
  intensity: number // 0.0 - 2.0 (default 1.0)
  algorithm: 'cas' | 'unsharp' | 'edge-enhance'
  preserveContrast: boolean
}

export interface SharpenerController {
  setOptions: (options: Partial<SharpenerOptions>) => void
  getOptions: () => SharpenerOptions
  processFrame: (sourceCanvas: HTMLCanvasElement, targetCanvas: HTMLCanvasElement) => void
  getConvolutionKernel: () => number[][]
}

export const CAS_WEBGPU_SHADER_CODE = `
@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let coords = vec2<i32>(global_id.xy);
  let dims = textureDimensions(inputTexture);
  if (coords.x >= dims.x || coords.y >= dims.y) {
    return;
  }
  let c = textureLoad(inputTexture, coords, 0);
  textureStore(outputTexture, coords, c);
}
`

/**
 * Checks if WebGPU is supported in current browser runtime.
 */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean((navigator as any).gpu)
}

/**
 * Computes Contrast Adaptive Sharpening (CAS) 3x3 convolution kernel weights.
 */
export function computeCasKernel(intensity: number): number[][] {
  const safeIntensity = Math.max(0, Math.min(2.0, intensity))
  const w = safeIntensity * 0.15

  // 3x3 kernel:
  // [  0, -w,  0 ]
  // [ -w, 1 + 4w, -w ]
  // [  0, -w,  0 ]
  return [
    [0, -w, 0],
    [-w, 1 + (4 * w), -w],
    [0, -w, 0],
  ]
}

/**
 * Generates CSS/SVG filter string representation for browser software fallback.
 */
export function createSoftwareSharpenFilter(intensity: number): string {
  const safe = Math.max(0, Math.min(2, intensity))
  return `contrast(${100 + safe * 20}%) brightness(${100 + safe * 5}%)`
}

/**
 * Applies software-level edge and font contrast sharpening to image pixels.
 * Used as fallback or high-precision frame processing for code terminal captures.
 */
export function applySharpenFilter(
  dataOrImage: ImageData | Uint8ClampedArray,
  widthOrOptions?: number | SharpenerOptions,
  heightParam?: number,
  optionsParam?: SharpenerOptions
): any {
  let width = 0
  let height = 0
  let data: Uint8ClampedArray
  let options: SharpenerOptions

  if (typeof widthOrOptions === 'object' && widthOrOptions !== null) {
    const imgData = dataOrImage as ImageData
    width = imgData.width
    height = imgData.height
    data = imgData.data
    options = widthOrOptions
  } else {
    data = dataOrImage as Uint8ClampedArray
    width = typeof widthOrOptions === 'number' ? widthOrOptions : 1
    height = heightParam || 1
    options = optionsParam || {
      enabled: true,
      intensity: 1.0,
      algorithm: 'cas',
      preserveContrast: true,
    }
  }

  if (!options.enabled || options.intensity <= 0) {
    return dataOrImage
  }

  const outData = new Uint8ClampedArray(data)
  const kernel = computeCasKernel(options.intensity)
  const k01 = kernel[0][1]
  const k10 = kernel[1][0]
  const k11 = kernel[1][1]
  const k12 = kernel[1][2]
  const k21 = kernel[2][1]

  const getPixel = (x: number, y: number, c: number): number => {
    const px = Math.min(width - 1, Math.max(0, x))
    const py = Math.min(height - 1, Math.max(0, y))
    return data[((py * width) + px) * 4 + c]
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = ((y * width) + x) * 4

      for (let c = 0; c < 3; c++) {
        let acc = 0
        acc += getPixel(x, y - 1, c) * k01
        acc += getPixel(x - 1, y, c) * k10
        acc += getPixel(x, y, c) * k11
        acc += getPixel(x + 1, y, c) * k12
        acc += getPixel(x, y + 1, c) * k21

        outData[idx + c] = Math.min(255, Math.max(0, acc))
      }
      outData[idx + 3] = data[idx + 3]
    }
  }

  if (typeof widthOrOptions === 'object' && widthOrOptions !== null) {
    if (typeof ImageData !== 'undefined') {
      return new ImageData(outData, width, height)
    }
  }
  return outData
}

/**
 * Creates an image/video frame sharpening processor.
 */
export function createVideoSharpener(
  initialOptions?: Partial<SharpenerOptions>
): SharpenerController {
  const options: SharpenerOptions = {
    enabled: true,
    intensity: 1.0,
    algorithm: 'cas',
    preserveContrast: true,
    ...initialOptions,
  }

  return {
    setOptions: (newOpts: Partial<SharpenerOptions>) => {
      Object.assign(options, newOpts)
    },
    getOptions: () => ({ ...options }),
    getConvolutionKernel: () => computeCasKernel(options.intensity),
    processFrame: (sourceCanvas: HTMLCanvasElement, targetCanvas: HTMLCanvasElement) => {
      const srcCtx = sourceCanvas.getContext('2d')
      const dstCtx = targetCanvas.getContext('2d')
      if (!srcCtx || !dstCtx) return

      const w = sourceCanvas.width
      const h = sourceCanvas.height
      targetCanvas.width = w
      targetCanvas.height = h

      if (!options.enabled || options.intensity <= 0) {
        dstCtx.drawImage(sourceCanvas, 0, 0)
        return
      }

      const imgData = srcCtx.getImageData(0, 0, w, h)
      const sharpened = applySharpenFilter(imgData, options)
      dstCtx.putImageData(sharpened, 0, 0)
    },
  }
}
