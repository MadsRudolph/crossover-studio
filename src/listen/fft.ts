// A small in-place radix-2 FFT for the listening IRs (16384 points) and the tests' spectra.
// Split real/imaginary Float64Arrays, as the engine's CArray. No DOM, no allocation per butterfly.

/** True when n is a power of two (and at least 1). */
export const isPow2 = (n: number): boolean => n >= 1 && (n & (n - 1)) === 0;

/** In-place complex FFT. inverse=true computes the inverse transform, scaled by 1/N. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (im.length !== n) throw new Error("fft: re and im differ in length");
  if (!isPow2(n)) throw new Error(`fft: length ${n} is not a power of two`);
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, ang = sign * 2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let s = 0; s < n; s += len) {
      // twiddle by recurrence, restarted per block: error stays ~1e-15 for 16384 points
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = s + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Real signal of length N from its one-sided spectrum (bins 0..N/2, Hermitian symmetry assumed).
 *  The imaginary parts of the DC and Nyquist bins are ignored. */
export function irfft(specRe: ArrayLike<number>, specIm: ArrayLike<number>, n: number): Float64Array {
  const re = new Float64Array(n), im = new Float64Array(n), h = n >> 1;
  if (specRe.length < h + 1 || specIm.length < h + 1) throw new Error(`irfft: need ${h + 1} bins`);
  re[0] = specRe[0];
  re[h] = specRe[h];
  for (let k = 1; k < h; k++) {
    re[k] = specRe[k]; im[k] = specIm[k];
    re[n - k] = specRe[k]; im[n - k] = -specIm[k];
  }
  fft(re, im, true);
  return re;
}

/** One-sided spectrum (bins 0..N/2) of a real signal whose length is a power of two. */
export function rfft(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im);
  return { re: re.slice(0, (n >> 1) + 1), im: im.slice(0, (n >> 1) + 1) };
}

/** The discrete-time Fourier transform of x at one frequency (Hz): exact between the FFT bins. */
export function dtft(x: ArrayLike<number>, fHz: number, fs: number): [number, number] {
  const w = -2 * Math.PI * fHz / fs, cr = Math.cos(w), ci = Math.sin(w);
  let er = 1, ei = 0, sr = 0, si = 0;
  for (let i = 0; i < x.length; i++) {
    sr += x[i] * er; si += x[i] * ei;
    const nr = er * cr - ei * ci;
    ei = er * ci + ei * cr; er = nr;
    // renormalise now and then so the recurrence keeps unit length over long signals
    if ((i & 1023) === 1023) { const m = Math.hypot(er, ei); er /= m; ei /= m; }
  }
  return [sr, si];
}
