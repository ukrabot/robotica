# -*- coding: utf-8 -*-
"""Clasificación de artículos en temas para la portada y /blog/.
Reglas en orden: gana la primera que coincide (sobre slug + categoría original)."""
import re

TOPICS = [
    # clave, nombre visible, descripción corta, ícono (lib ICON de las ilustraciones)
    ('hogar', 'Electrodomésticos y hogar', 'Qué comprar y cuánto consume: cocina, lavado, climatización.', 'home'),
    ('domotica', 'Domótica y seguridad', 'Casa inteligente, cámaras, alarmas y Home Assistant.', 'wifi'),
    ('energia', 'Energía, baterías y solar', 'Celdas 18650, LiFePO4, BMS, paneles solares y respaldo.', 'battery'),
    ('movilidad', 'Movilidad eléctrica', 'Bicicletas, scooters, conversión a eléctrico y carga.', 'bolt'),
    ('tecnologia', 'Computadores, redes e IA', 'PC, notebooks, redes WiFi, NAS e IA en hardware propio.', 'cpu'),
    ('arduino', 'Arduino, ESP32 y Raspberry Pi', 'Microcontroladores, placas y proyectos paso a paso.', 'code'),
    ('sensores', 'Sensores y electrónica', 'Medir distancia, temperatura, gas, luz y movimiento.', 'eye'),
    ('robotica', 'Brazos robóticos y ROS 2', 'Cinemática, pinzas, actuadores, visión y navegación.', 'gear'),
    ('industrial', 'Automatización industrial', 'PLC, Modbus, variadores y seguridad en celdas.', 'shield'),
    ('fabricacion', 'Impresión 3D, CNC y láser', 'Impresoras, firmware, fresadoras y grabado láser.', 'target'),
    ('taller', 'Herramientas y taller', 'Soldar, medir y reparar con el equipo correcto.', 'check'),
    ('educacion', 'Robótica educativa', 'Kits, ferias científicas y robótica en el aula.', 'up'),
]

RULES = [
    ('educacion', r'educativ|docente|aula|feria-cientifica|competencias-de-robotica|mblock|scratch|colegios'),
    ('movilidad', r'bicicleta|scooter|convert(ir|ida)?-un-auto|conversion|coche-electrico|vehiculo|auto-electrico|cargador-de-auto|homologacion|motor-electrico-para|dash-cam|movilidad|baterias-lfp-vs-nmc'),
    ('hogar', r'refrigerador|lavadora|lavavajillas|secadora|freidora|cafetera|microondas|horno-electrico|cocina-induccion|plancha|aspiradora|ventilador|calefactor|deshumidificador|aire-acondicionado|agua-caliente|calefaccion|purificador|cepillo|electrodom|climatizaci|silla-ergonomica'),
    ('domotica', r'domotica|home-assistant|camaras-de-seguridad|camara-de-vigilancia|alarma|cerradura|timbre|enchufes-inteligentes|luces-led|termostato|altavoces-inteligentes|robot-aspiradora|frigate|smart-home|gallinero|riego'),
    ('energia', r'bateria|baterias|bms|18650|21700|lifepo4|celdas|solar|mppt|generador|ups-|estaciones-de-energia|cuenta-de-la-luz|tp4056|scooter-electrico-xiaomi|energia|power-loss|pack'),
    ('fabricacion', r'impresora-3d|impresoras-3d|impresion-3d|filamento|klipper|marlin|boquillas|input-shaper|resina|cnc|laser|grbl|mach3|husillos|nivelacion|camaras-cerradas|ceramica|gran-formato|bambu|creality|defectos-de-impresion'),
    ('industrial', r'plc|industrial|modbus|vfd|variadores|hmi|celdas-roboticas|cortinas-de-luz|escaneres-de-area|parada-de-emergencia|evaluacion-de-riesgo|normas-de-seguridad|colaborativos|paletizado|soldadura|ensamblaje|rele-ssr|contactor'),
    ('robotica', r'brazo|robotic|cinematica|ros-2|ros2|slam|nav2|pinza|efector|servos-inteligentes|harmonic|reductores|encoder|hexapodo|lidar|robot|transmision|actuador|motores-bldc|closed-loop|fibra-de-carbono|chasis|gestion-de-cables|refrigeracion-para-motores|proteccion-contra-polvo|reduccion-de-ruido|mantenimiento-para-brazos|calibracion-de-brazos|vision-computacional|sensores-de-fuerza|nema|driver-a4988|paso-a-paso'),
    ('taller', r'multimetro|osciloscop|soldar|soldadura-por-puntos|estaciones-de-soldadura|fuentes-de|fuente-atx|crimp|calibres|camaras-termicas|taladros|programadores-universales|simuladores|que-cable|herramient|reparar|repara-|diagnostico-de-bms'),
    ('tecnologia', r'notebook|monitor|teclado|celular|tablet|smartwatch|router|wifi-mesh|internet-para|vpn|nas|ssd|mini-pc|servidor|docker|armar-un-pc|cargadores-usb|impresoras-tinta|smart-tv|proyectores|audifonos|barras-de-sonido|ollama|stable-diffusion|lora-en-hardware|jetson|npu|orange-pi|rk3588|drones|ia-'),
    ('sensores', r'sensor|hc-sr04|dht22|mq-2|pir|ldr|ultrasonico|celdas-de-carga|hx711|gps|detector|estacion-meteorologica|radar|medicion|rew'),
    ('arduino', r'arduino|esp32|raspberry|pico|teensy|nrf52|freertos|ota|blynk|thingspeak|mqtt|lora|i2c|can-|mcp2515|mosfet|l298n|servomotor|bluetooth|hc-05|buck|lm2596|semaforo|piano|consola-retro|arcade|bomba-peristaltica|altavoz|amplificador|crossover|iot'),
]
_C = [(k, re.compile(p)) for k, p in RULES]


def classify(slug, eyebrow=''):
    s = slug + ' ' + (eyebrow or '').lower()
    for k, rx in _C:
        if rx.search(slug):
            return k
    # respaldo por categoría original
    e = (eyebrow or '').lower()
    for k, words in [('arduino', 'arduino esp32 embebid sbc raspberry iot'), ('sensores', 'sensor instrument metrolog'), ('robotica', 'robót robot ros mecánic'),
                     ('industrial', 'industrial'), ('fabricacion', '3d cnc láser laser'), ('energia', 'energ bater'), ('taller', 'taller herramient reparaci'),
                     ('tecnologia', 'redes servidor ia inteligencia audio'), ('domotica', 'domótica'), ('hogar', 'hogar')]:
        if any(w in e for w in words.split()):
            return k
    return 'arduino'

# Ajustes manuales donde las reglas se equivocan (revisados a mano)
OVERRIDES = {
    'celdas-de-carga-y-hx711-basculas-de-precision-con-arduino': 'sensores',
    'celulares-cual-comprar-procesador-camara-bateria-y-actualizaciones': 'tecnologia',
    'notebooks-cual-comprar-procesador-ram-pantalla-y-bateria': 'tecnologia',
    'escaneres-de-area-para-seguridad-en-celdas-roboticas': 'industrial',
    'integracion-de-cortinas-de-luz-en-celdas-roboticas': 'industrial',
    'recuperacion-tras-corte-de-energia-power-loss-recovery-en-la-practica': 'fabricacion',
    'amplificadores-clase-d-guia-de-compra-y-montaje': 'sensores',
    'como-disenar-un-crossover-pasivo-para-altavoces-de-2-vias': 'sensores',
    'construye-tu-propio-altavoz-bluetooth-de-alta-fidelidad': 'sensores',
    'convertidor-buck-lm2596-ajustar-diagnosticar': 'sensores',
    'mosfet-con-arduino-irlz44n-vs-irfz44n': 'sensores',
    'construccion-de-una-maquina-recreativa-arcade-desde-cero-guia-completa-para-makers': 'arduino',
    'control-de-motores-dc-con-arduino-y-l298n-guia-completa': 'arduino',
    'control-pid-con-arduino-sintonia-ziegler-nichols': 'arduino',
    'esp32-con-bluetooth-ble-control-desde-el-celular': 'arduino',
    'lora-y-lorawan-para-telemetria-alcance-real-y-regulacion-en-chile': 'arduino',
    'mejores-kits-de-arduino-para-principiantes-guia-de-compra': 'arduino',
    'monitoreo-remoto-de-sensores-con-blynk': 'arduino',
    'placas-esp32-cual-elegir-para-tu-proyecto-guia-de-compra': 'arduino',
    'bus-can-con-mcp2515-y-arduino-de-obd-ii-a-robotica': 'arduino',
    'guia-esencial-de-sensores-para-arduino': 'sensores',
    'sensor-ultrasonico-hc-sr04-medicion-de-distancias-paso-a-paso': 'sensores',
    'sensores-infrarrojos-para-robots-siguelineas': 'sensores',
    'detector-de-gas-con-sensor-mq-2-y-alarma-sonora': 'sensores',
    'como-montar-un-servidor-nas-casero-con-discos-sata-guia-paso-a-paso': 'tecnologia',
    'como-soldar-con-estano-electronica-paso-a-paso': 'taller',
    'como-usar-un-multimetro-guia-paso-a-paso': 'taller',
    'fuente-atx-como-fuente-de-banco-paso-a-paso': 'taller',
    'estaciones-de-soldadura-como-elegir-la-adecuada-para-electronica': 'taller',
    'soldadura-por-puntos-guia-de-compra-y-uso-del-spot-welder': 'taller',
    'impresoras-tinta-vs-laser-vs-tanque-de-tinta-guia-de-compra': 'tecnologia',
    'termostatos-inteligentes-y-control-de-calefaccion-guia-de-compra': 'domotica',
}
_classify_rules = classify


def classify(slug, eyebrow=''):
    return OVERRIDES.get(slug) or _classify_rules(slug, eyebrow)
