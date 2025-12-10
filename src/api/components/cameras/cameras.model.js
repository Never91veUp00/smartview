'use-strict';

import { getAndStoreSnapshot } from '../../../common/ffmpeg.js';
import Ping from '../../../common/ping.js';

import ConfigService from '../../../services/config/config.service.js';

import Database from '../../database.js';

import CameraController from '../../../controller/camera/camera.controller.js';

// Функция для извлечения и форматирования URL из source
const extractAndFormatUrl = (source) => {
  if (!source) return '';

  const cleanSource = source.replace(/\u00A0/g, ' ');
  const match = cleanSource.match(/-i\s+(\S+)/);

  if (!match) return '';

  const url = match[1];

  // Проверяем, является ли это валидным URL
  try {
    const parsedUrl = new URL(url);
    // Это сетевой источник (rtsp://, http:// и т.д.)
    return `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? ':' + parsedUrl.port : ''}${parsedUrl.pathname}`;
  } catch (error) {
    // Не валидный URL - значит это локальный файл
    if (url.startsWith('/')) {
      // Unix путь
      return `file://${url}`;
    } else if (/^[A-Za-z]:[\\\/]/.test(url)) {
      // Windows абсолютный путь
      return `file:///${url.replace(/\\/g, '/')}`;
    } else if (url.startsWith('./') || url.startsWith('../')) {
      // Относительный путь
      return `file:///${url.replace(/\\/g, '/')}`;
    } else {
      // Неизвестный формат
      return url;
    }
  }
};

// Функция для подготовки videoConfig
const prepareVideoConfig = (videoConfig) => {
  if (!videoConfig) return videoConfig;

  const config = { ...videoConfig };

  // Убираем -re и -stream_loop из stillImageSource если они есть
  if (config.stillImageSource) {
    config.stillImageSource = config.stillImageSource
      .replace(/-re\s+/g, '')
      .replace(/-stream_loop\s+-1\s+/g, '')
      .trim();
  }

  // Если stillImageSource не указан, создаем из source
  if (!config.stillImageSource && config.source) {
    config.stillImageSource = config.source
      .replace(/-re\s+/g, '')
      .replace(/-stream_loop\s+-1\s+/g, '')
      .trim();
  }

  return config;
};

// Функция для добавления форматированного URL к камере
const addFormattedUrlToCamera = (camera) => {
  if (camera.videoConfig && camera.videoConfig.source) {
    camera.url = extractAndFormatUrl(camera.videoConfig.source);
  }
  return camera;
};

export const list = async () => {
  const cameras = await Database.interfaceDB.chain.get('cameras').cloneDeep().value();

  // Добавляем форматированные URL для каждой камеры
  return cameras.map(camera => addFormattedUrlToCamera(camera));
};

export const findByName = async (name) => {
  const camera = await Database.interfaceDB.chain.get('cameras').find({ name: name }).cloneDeep().value();

  if (camera) {
    return addFormattedUrlToCamera(camera);
  }

  return camera;
};

export const getSettingsByName = async (name) => {
  const settings = await Database.interfaceDB.chain.get('settings').get('cameras').find({ name: name }).cloneDeep().value();

  if (settings) {
    // Для настроек также добавляем URL если есть source
    if (settings.videoConfig && settings.videoConfig.source) {
      settings.url = extractAndFormatUrl(settings.videoConfig.source);
    }
  }

  return settings;
};

export const createCamera = async (cameraData) => {
  // Подготовка cameraData перед сохранением
  const preparedData = { ...cameraData };

  if (preparedData.videoConfig) {
    preparedData.videoConfig = prepareVideoConfig(preparedData.videoConfig);
  }

  const camExist = ConfigService.ui.cameras.find((cam) => cam.name === preparedData.name);

  if (!camExist) {
    ConfigService.ui.cameras.push(preparedData);
    ConfigService.writeToConfig('cameras', ConfigService.ui.cameras);

    CameraController.createController(preparedData);
    await CameraController.startController(preparedData.name);

    await Database.writeConfigCamerasToDB();
    Database.controller?.emit('addCamera', preparedData);

    return preparedData;
  } else {
    return false;
  }
};

// todo: not used, handled through system/config
export const patchCamera = async (name, cameraData) => {
  if (
    cameraData.name &&
    name !== cameraData.name &&
    ConfigService.ui.cameras.some((camera) => camera.name === cameraData.name)
  ) {
    throw new Error('Camera already exists in config.json');
  }

  // Подготовка cameraData перед сохранением
  const preparedData = { ...cameraData };

  if (preparedData.videoConfig) {
    preparedData.videoConfig = prepareVideoConfig(preparedData.videoConfig);
  }

  ConfigService.ui.cameras = ConfigService.ui.cameras.map((camera) => {
    if (camera.name === name) {
      return {
        ...camera,
        ...preparedData,
      };
    }

    return camera;
  });

  ConfigService.writeToConfig('cameras', ConfigService.ui.cameras);
  await Database.writeConfigCamerasToDB();

  const updatedCamera = await Database.interfaceDB.chain.get('cameras').find({ name: name }).assign(preparedData).value();

  return addFormattedUrlToCamera(updatedCamera);
};

export const pingCamera = async (camera, timeout) => {
  timeout = (Number.parseInt(timeout) || 0) < 1 ? 1 : Number.parseInt(timeout);
  return await Ping.status(camera, timeout);
};

export const requestSnapshot = async (camera, fromSubSource) => {
  return await getAndStoreSnapshot(camera, fromSubSource);
};

export const removeByName = async (name) => {
  ConfigService.ui.cameras = ConfigService.ui.cameras.filter((camera) => camera.name !== name);
  ConfigService.writeToConfig('cameras', ConfigService.ui.cameras);

  await CameraController.removeController(name);

  await Database.writeConfigCamerasToDB();
  Database.controller?.emit('removeCamera', name);
};

export const removeAll = async () => {
  const cameras = ConfigService.ui.cameras.map((camera) => camera.name);

  ConfigService.ui.cameras = [];
  ConfigService.writeToConfig('cameras', ConfigService.ui.cameras);

  for (const cameraName of cameras) {
    await CameraController.removeController(cameraName);
  }

  await Database.writeConfigCamerasToDB();
  Database.controller?.emit('removeCameras');
};