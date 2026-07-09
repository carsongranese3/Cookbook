/**
 * Shared image utilities.
 */

/**
 * Downscale a File (image) to a JPEG data-URI, constraining the longest
 * dimension to `maxDim` pixels. Returns the original dimensions untouched if
 * already small enough.
 *
 * @param {File} file
 * @param {number} [maxDim=800]
 * @returns {Promise<string>} JPEG data URI
 */
export async function fileToDownscaledDataUrl(file, maxDim = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height / width) * maxDim);
          width = maxDim;
        } else {
          width = Math.round((width / height) * maxDim);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}
