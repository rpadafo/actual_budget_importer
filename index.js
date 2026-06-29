import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import api from '@actual-app/api';

const CARPETA_CSV = '/csv';

// Configuración de Actual Budget desde variables de entorno
const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL;
const ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD;
const ACTUAL_SYNC_ID = process.env.ACTUAL_SYNC_ID; // El ID de tu archivo de presupuesto

// Mapeo de prefijos de archivos a IDs de cuentas de Actual Budget
const CUENTAS_MAPA = {
  'BK': process.env.ACCOUNT_ID_BANKINTER,
  'LC': process.env.ACCOUNT_ID_LACAIXA,
  'SA': process.env.ACCOUNT_ID_SANTANDER,
  'BS': process.env.ACCOUNT_ID_SABADELL
};

// Función para formatear la fecha de log
function obtenerFechaLog() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

async function importarCSV(rutaArchivo) {
  const nombreArchivo = path.basename(rutaArchivo);
  const prefijo = nombreArchivo.split('_')[0];
  const accountId = CUENTAS_MAPA[prefijo];

  if (!accountId) {
    console.log(`[${obtenerFechaLog()}] ❌ No se encontró cuenta asignada en Actual para el prefijo: ${prefijo}`);
    return;
  }

  console.log(`[${obtenerFechaLog()}] 🔄 Conectando a Actual Budget para procesar: ${nombreArchivo}...`);
  
  try {
    // 1. Inicializar la API y conectar
    await api.init({ serverURL: ACTUAL_SERVER_URL, password: ACTUAL_PASSWORD });
    await api.downloadBudget(ACTUAL_SYNC_ID);

    // 2. Leer el archivo CSV línea por línea
    const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
    const lineas = contenido.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Ignoramos la cabecera del CSV
    const cabecera = lineas[0].split(';');
    const transacciones = [];

    // Mapear los índices del CSV dinámicamente según las columnas estándar que creamos
    const idxFecha = cabecera.findIndex(c => c.toLowerCase().includes('fecha'));
    const idxConcepto = cabecera.findIndex(c => c.toLowerCase().match(/(concepto|descripci|movimiento)/));
    const idxImporte = cabecera.findIndex(c => c.toLowerCase().includes('importe'));

    for (let i = 1; i < lineas.length; i++) {
      const columnas = lineas[i].split(';');
      
      // Parsear importe español (cambiar puntos de miles si hubiera y comas decimales a puntos)
      let importeTexto = columnas[idxImporte] || '0';
      let importeCentavos = Math.round(parseFloat(importeTexto.replace(/\./g, '').replace(',', '.')) * 100);

      // Convertir fecha DD/MM/AAAA a AAAA-MM-DD para Actual Budget
      const partesFecha = columnas[idxFecha].split('/');
      const fechaFormateada = `${partesFecha[2]}-${partesFecha[1]}-${partesFecha[0]}`;

      transacciones.push({
        date: fechaFormateada,
        account: accountId,
        amount: importeCentavos, // Actual Budget requiere el importe en enteros (centavos)
        payee_name: columnas[idxConcepto] || 'Movimiento Automatizado',
        imported_id: `${fechaFormateada}_${importeCentavos}_${i}` // Evita duplicados si se procesa dos veces
      });
    }

    // 3. Enviar transacciones a Actual Budget
    if (transacciones.length > 0) {
      await api.importTransactions(accountId, transacciones);
      console.log(`[${obtenerFechaLog()}] ✅ Importadas con éxito ${transacciones.length} transacciones en la cuenta [${prefijo}].`);
    } else {
      console.log(`[${obtenerFechaLog()}] ⚠️ No se encontraron transacciones válidas en el archivo.`);
    }

    // 4. Cerrar sesión limpiamente
    await api.shutdown();

  } catch (error) {
    // Error en ROJO usando códigos ANSI estándar tal y como pediste en Python
    console.error(`\x1b[1;\x1b[31m[${obtenerFechaLog()}] 💥 Error importando a Actual Budget: ${error.message}\x1b[0m`);
  }
}

// Iniciar el monitor de la carpeta /csv
console.log(`[${obtenerFechaLog()}] 🤖 Importador de Actual Budget listo. Vigilando carpeta ${CARPETA_CSV}...`);

const watcher = chokidar.watch(CARPETA_CSV, {
  ignored: /(^|[\/\\])\../,
  persistent: true,
  ignoreInitial: true // Ignora lo que ya estuviera en la carpeta al arrancar
});

watcher.on('add', (ruta) => {
  if (ruta.endsWith('.csv')) {
    // Espera de seguridad para asegurar que el script de Python terminó de escribir el archivo
    setTimeout(() => importarCSV(ruta), 1500);
  }
});