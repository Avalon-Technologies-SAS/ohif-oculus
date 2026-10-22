import { registerImageLoader, utilities as csUtils } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

import parseVOILUTSequence from './parseVOILUTSequence';
import type { ParsedVOILUT } from './parseVOILUTSequence';
import applyVOILUTToPixelData from './applyVOILUTToPixelData';

/**
 * Política v1: solo imágenes monocromas de estas modalidades son elegibles,
 * para reducir el riesgo del cambio de pipeline de píxeles.
 */
const ELIGIBLE_MODALITIES = ['CR', 'DX', 'MG'];

/**
 * Resolutor de metadata por imageId (clases.MetadataProvider de @ohif/core).
 * Se inyecta para evitar un ciclo de imports utils -> classes -> utils.
 */
export interface InstanceMetadataProvider {
  getInstance(imageId: string): Record<string, unknown> | undefined;
}

type ImageLoadObject = {
  promise: Promise<Record<string, any>>;
  cancelFn?: () => void;
  decache?: () => void;
};

type DicomImageLoaderFn = (imageId: string, options?: unknown) => ImageLoadObject;

/**
 * Origen de la LUT: la instancia (naturalizada) que contiene la VOILUTSequence y
 * el objeto que sirve de clave para la cache de LUT parseadas.
 */
type VOILUTSource = {
  instance: Record<string, any>;
  cacheKey: object;
};

// Cache de LUT parseada por origen (evita reprocesar el parseo cuando varios
// imageIds/frames comparten la misma instancia o cuando la cache de imágenes
// de Cornerstone expulsa y recarga una imagen).
const parsedLUTCache = new WeakMap<object, ParsedVOILUT | null>();

function getParsedVOILUT({ instance, cacheKey }: VOILUTSource): ParsedVOILUT | null {
  if (parsedLUTCache.has(cacheKey)) {
    return parsedLUTCache.get(cacheKey);
  }
  const parsed = parseVOILUTSequence(instance) ?? null;
  parsedLUTCache.set(cacheKey, parsed);
  return parsed;
}

/**
 * Construye una pseudo-instancia naturalizada con la VOILUTSequence leída del
 * dataset P10 que el loader wadouri ya descargó y cacheó. Cubre el modo
 * dicomjson, donde la metadata OHIF sale del JSON y puede no traer la secuencia.
 *
 * Solo se toma el primer item (política v1). LUTData se entrega como vista
 * sobre los bytes OW del dataset; parseVOILUTSequence la copia.
 */
function getVOILUTInstanceFromDataSet(imageId: string): VOILUTSource | undefined {
  const { url } = dicomImageLoader.wadouri.parseImageId(imageId);
  const dataSet = dicomImageLoader.wadouri.dataSetCacheManager.get(url);
  const item = dataSet?.elements?.x00283010?.items?.[0]?.dataSet;
  const lutDataElement = item?.elements?.x00283006;
  if (!item?.elements?.x00283002 || !lutDataElement?.length) {
    return;
  }

  // Los items de una secuencia comparten el byteArray del dataset padre y
  // dataOffset es absoluto dentro de ese byteArray.
  const { byteArray } = item;
  const LUTData = new Uint8Array(
    byteArray.buffer,
    byteArray.byteOffset + lutDataElement.dataOffset,
    lutDataElement.length
  );

  return {
    instance: {
      VOILUTSequence: [
        {
          LUTDescriptor: [0, 1, 2].map(index => item.uint16('x00283002', index)),
          LUTData,
        },
      ],
      PixelRepresentation: dataSet.uint16('x00280103'),
      Modality: dataSet.string('x00080060'),
      PhotometricInterpretation: dataSet.string('x00280004'),
      SamplesPerPixel: dataSet.uint16('x00280002'),
    },
    cacheKey: item,
  };
}

/**
 * Resuelve de dónde sale la VOILUTSequence:
 * 1. La metadata OHIF (DICOMweb JSON / DICOM JSON), comportamiento v1.
 * 2. Si no la trae, el dataset P10 cacheado por el loader wadouri.
 */
function resolveVOILUTSource(
  imageId: string,
  metadataProvider: InstanceMetadataProvider
): VOILUTSource | undefined {
  const instance = metadataProvider.getInstance(imageId);
  if (instance?.VOILUTSequence) {
    return { instance, cacheKey: instance };
  }

  const dataSetSource = getVOILUTInstanceFromDataSet(imageId);
  if (!dataSetSource) {
    return;
  }

  // La metadata OHIF (si existe) manda sobre la del dataset para elegibilidad.
  return {
    instance: { ...dataSetSource.instance, ...pickEligibilityFields(instance) },
    cacheKey: dataSetSource.cacheKey,
  };
}

function pickEligibilityFields(instance): Record<string, unknown> {
  const fields = {};
  ['Modality', 'PhotometricInterpretation', 'SamplesPerPixel', 'PixelRepresentation'].forEach(
    key => {
      if (instance?.[key] !== undefined && instance[key] !== '') {
        fields[key] = instance[key];
      }
    }
  );
  return fields;
}

function isEligibleInstance(instance): boolean {
  if (!ELIGIBLE_MODALITIES.includes(instance.Modality)) {
    return false;
  }

  const photometric = instance.PhotometricInterpretation;
  if (typeof photometric !== 'string' || !photometric.startsWith('MONOCHROME')) {
    return false;
  }

  const samplesPerPixel = Number(instance.SamplesPerPixel ?? 1);
  return samplesPerPixel === 1;
}

/**
 * Aplica la VOILUTSequence sobre un IImage recién cargado, si la instancia es
 * elegible. Devuelve la misma imagen (mutada) para mantener el resto de campos.
 *
 * Ajustes post-transformación (estado inicial y reset consistentes):
 * - pixelData/voxelManager con el buffer remapeado.
 * - min/maxPixelValue al rango transformado.
 * - windowCenter/windowWidth identidad sobre ese rango (VOI lineal).
 * - slope/intercept identidad: la Modality LUT ya quedó incorporada al remapeo.
 */
export function applyVOILUTSequenceToImage(
  image,
  imageId: string,
  metadataProvider: InstanceMetadataProvider
) {
  try {
    if (!image || image.color) {
      return image;
    }

    const source = resolveVOILUTSource(imageId, metadataProvider);
    if (!source || !isEligibleInstance(source.instance)) {
      return image;
    }

    const voiLut = getParsedVOILUT(source);
    if (!voiLut) {
      return image;
    }

    const scalarData = image.voxelManager?.getScalarData?.() ?? image.getPixelData();
    if (!scalarData?.length) {
      return image;
    }

    // Si el loader ya reescaló los píxeles (preScale), la Modality LUT ya está
    // aplicada y la LUT se indexa directamente con el valor almacenado.
    const alreadyScaled = Boolean(image.preScale?.scaled);
    const slope = alreadyScaled ? 1 : (image.slope ?? 1);
    const intercept = alreadyScaled ? 0 : (image.intercept ?? 0);

    const { pixelData, minPixelValue, maxPixelValue } = applyVOILUTToPixelData(
      scalarData,
      voiLut,
      slope,
      intercept
    );

    const voxelManager = csUtils.VoxelManager.createImageVoxelManager({
      scalarData: pixelData,
      width: image.width,
      height: image.height,
      numberOfComponents: 1,
    });

    image.voxelManager = voxelManager;
    image.getPixelData = () => pixelData;
    image.dataType = pixelData.constructor.name;
    image.sizeInBytes = pixelData.byteLength;

    if (image.imageFrame) {
      image.imageFrame.pixelData = pixelData;
      image.imageFrame.pixelDataLength = pixelData.length;
      image.imageFrame.smallestPixelValue = minPixelValue;
      image.imageFrame.largestPixelValue = maxPixelValue;
    }

    image.minPixelValue = minPixelValue;
    image.maxPixelValue = maxPixelValue;
    image.slope = 1;
    image.intercept = 0;
    if (image.preScale) {
      image.preScale = { ...image.preScale, scaled: false };
    }

    // VOI identidad sobre el rango de salida de la LUT (PS3.3 C.11.2.1.2):
    // lower = c - 0.5 - (w-1)/2 = min ; upper = c - 0.5 + (w-1)/2 = max.
    image.windowWidth = Math.max(maxPixelValue - minPixelValue + 1, 1);
    image.windowCenter = (minPixelValue + maxPixelValue + 1) / 2;
    image.voiLUTFunction = 'LINEAR';

    return image;
  } catch (error) {
    console.warn(`VOILUTSequence: fallo aplicando la LUT para ${imageId}`, error);
    return image;
  }
}

function wrapLoader(
  baseLoadImage: DicomImageLoaderFn,
  metadataProvider: InstanceMetadataProvider
): DicomImageLoaderFn {
  return function voiLutSequenceLoader(imageId, options) {
    const imageLoadObject = baseLoadImage(imageId, options);
    return {
      ...imageLoadObject,
      promise: imageLoadObject.promise.then(image =>
        applyVOILUTSequenceToImage(image, imageId, metadataProvider)
      ),
    };
  };
}

let registered = false;

/**
 * Envuelve los loaders DICOM de @cornerstonejs/dicom-image-loader para aplicar
 * VOILUTSequence pixel a pixel en carga, sin tocar extension-cornerstone.
 *
 * Debe invocarse DESPUÉS de dicomImageLoader.init() (que registra los esquemas
 * originales); de lo contrario ese init sobrescribiría estos wrappers. En OHIF
 * eso significa después del preRegistration de extension-cornerstone, p. ej.
 * en el onModeEnter de una extensión.
 */
export default function registerVOILUTSequenceImageLoader(
  metadataProvider: InstanceMetadataProvider
): void {
  if (registered) {
    return;
  }
  registered = true;

  const { wadors, wadouri } = dicomImageLoader;

  registerImageLoader('wadors', wrapLoader(wadors.loadImage as DicomImageLoaderFn, metadataProvider) as any);

  const wadouriLoader = wrapLoader(wadouri.loadImage as DicomImageLoaderFn, metadataProvider);
  registerImageLoader('wadouri', wadouriLoader as any);
  registerImageLoader('dicomweb', wadouriLoader as any);
  registerImageLoader('dicomfile', wadouriLoader as any);
}
