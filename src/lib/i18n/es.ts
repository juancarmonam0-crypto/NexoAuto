/**
 * Nexo Auto — public (customer-facing) Spanish copy.
 *
 * Written as United States customer-facing Spanish, not a literal translation
 * of the English file. The goal is that a Spanish-speaking buyer reads a page
 * that sounds like it was written in Spanish, while every factual promise —
 * especially anything about financing — is IDENTICAL in strength to the English
 * edition. Nothing here may imply guaranteed approval.
 *
 * The key set is enforced by the dictionary type: `npm run typecheck` fails if
 * this file and `en.ts` drift apart, so a page can never be 70% translated
 * without the build saying so.
 *
 * Vehicle DATA (VIN, stock number, make, model, trim, mileage, prices) is never
 * translated — only the labels around it.
 */
export const es = {
  // ---- Shared / metadata -------------------------------------------------
  "meta.siteName": "Nexo Auto",
  "meta.home.title": "Nexo Auto — Comprar un auto, sin complicaciones",
  "meta.home.description":
    "Explora una selección cuidada de autos usados con precios claros, opciones de financiamiento sencillas y un proceso digital que puedes hacer desde tu teléfono.",
  "meta.inventory.title": "Inventario",
  "meta.inventory.description":
    "Consulta todos los vehículos disponibles en Nexo Auto con precio, millaje, equipamiento y fotos.",
  "meta.vehicle.notFound": "Vehículo no encontrado",
  "meta.vehicle.description": "{vehicle} con {mileage} millas, disponible en Nexo Auto por {price}.",
  "meta.tagline": "Comprar un auto, sin complicaciones",

  // ---- Brand family ------------------------------------------------------
  "brand.familyNote": "Parte de la familia {family} — el mismo equipo detrás de Nexo Rental.",
  "brand.familyName": "Nexo",

  // ---- Language selector -------------------------------------------------
  "language.label": "Idioma",
  "language.switchTo": "Cambiar a {language}",
  "language.english": "Inglés",
  "language.spanish": "Español",

  // ---- Header / navigation ----------------------------------------------
  "nav.primary": "Principal",
  "nav.home": "{name} — inicio",
  "nav.inventory": "Inventario",
  "nav.howItWorks": "Cómo funciona",
  "nav.buyingOptions": "Opciones de compra",
  "nav.browseCars": "Ver autos",
  "nav.browseCarsShort": "Ver autos",
  "nav.callDealer": "Llamar a {name} al {phone}",
  "nav.operatorSignIn": "Acceso de operadores",

  // ---- Accessibility -----------------------------------------------------
  "a11y.srHeadline": "{name} — autos usados, precios claros, compra sencilla",

  // ---- Homepage: hero ----------------------------------------------------
  "home.hero.badge": "Comprar un auto, sin complicaciones",
  "home.hero.headlineFallback": "Menos autos. Elegidos con cuidado.",
  "home.hero.subtextFallback":
    "Nexo Auto es una agencia pequeña y moderna con una idea central: comprar un auto usado debería ser simple, claro y sin presión. Mira los autos, conoce precios reales y arma una compra que quepa en tu presupuesto.",
  "home.hero.primaryCta": "Ver inventario",
  "home.hero.secondaryCta": "Ver cómo funciona",
  "home.hero.assuranceInventory": "Inventario real y disponible",
  "home.hero.assurancePricing": "Precios claros",
  "home.hero.assuranceFinancing": "Te ayudamos con el financiamiento",
  "home.hero.preferTalk": "¿Prefieres hablarlo con alguien?",
  "home.hero.call": "Llama al {phone}",
  "home.hero.email": "Escríbenos",

  // ---- Homepage: benefits -------------------------------------------------
  "home.benefits.eyebrow": "Por qué Nexo Auto",
  "home.benefits.title": "Comprar un auto sin las trabas de siempre",
  "home.benefits.subtitle":
    "Sin presión de piso de venta, sin una lista interminable de cargos y sin misterio en el precio. Así se ve en la práctica.",
  "home.benefits.pricing.title": "El precio a la vista",
  "home.benefits.pricing.body":
    "Cada vehículo publicado muestra su precio en la tarjeta. Sin “llama para saber el precio”, sin anuncios gancho y sin cargos sorpresa antes de que decidas algo.",
  "home.benefits.market.title": "Precios inteligentes, menos conjeturas",
  "home.benefits.market.body":
    "Fijamos el precio con evidencia real del mercado, no por corazonada, para que el número que ves refleje lo que de verdad se están vendiendo autos comparables.",
  "home.benefits.options.title": "Opciones que caben en tu presupuesto",
  "home.benefits.options.body":
    "De contado, con financiamiento tradicional o con un plan armado alrededor de lo que puedes dar de enganche. Ves la estructura antes de comprometerte.",
  "home.benefits.mobile.title": "Pensado para tu teléfono",
  "home.benefits.mobile.body":
    "Busca, compara y pide detalles desde el teléfono que traes en la mano. No necesitas ir a la agencia solo para saber si vale la pena ver un auto.",
  "home.benefits.selection.title": "Menos autos, elegidos con cuidado",
  "home.benefits.selection.body":
    "Mantenemos el inventario pequeño a propósito. Cada vehículo recibe atención real antes de publicarse y nada queda ahí solo para llenar espacio.",
  "home.benefits.cta.title": "Listos cuando tú lo estés",
  "home.benefits.cta.body":
    "Empieza por los autos. Si algo te late, nosotros seguimos — no hay formularios para poder ver el precio.",
  "home.benefits.cta.action": "Ver autos disponibles",

  // ---- Homepage: inventory preview ---------------------------------------
  "home.inventory.titleWithStock": "Disponibles ahora",
  "home.inventory.titleEmpty": "Inventario actual",
  "home.inventory.bodyWithStock":
    "Los vehículos publicados hoy, con el precio en la tarjeta. Toca cualquiera para ver fotos, especificaciones y el detalle completo.",
  "home.inventory.bodyEmpty":
    "Publicamos los vehículos cuando están listos, no antes. Ahora mismo no hay nada publicado y preferimos mostrarte una página vacía que un auto que no puedes comprar.",
  "home.inventory.viewAll": "Ver todo el inventario",
  "home.inventory.empty.title": "Estamos eligiendo nuevos vehículos",
  "home.inventory.empty.body":
    "El inventario cambia conforme conseguimos y preparamos autos. Dinos qué buscas y te avisamos cuando algo encaje — o vuelve a revisar en un rato.",
  "home.inventory.empty.call": "Llama al {phone}",
  "home.inventory.empty.email": "Dinos qué necesitas",
  "home.inventory.empty.recheck": "Revisar el inventario otra vez",
  "home.inventory.empty.mailSubject": "Solicitud de vehículo — {name}",

  // ---- Homepage: how it works --------------------------------------------
  "home.steps.eyebrow": "Cómo funciona",
  "home.steps.title": "Cuatro pasos, sin sorpresas",
  "home.steps.subtitle":
    "El mismo proceso si pagas de contado o con financiamiento. Siempre sabrás en qué punto estás y qué sigue.",
  "home.steps.1.title": "Mira los autos",
  "home.steps.1.body":
    "Empieza por lo que realmente está disponible. Fotos, millaje, equipamiento y precio en una sola página clara.",
  "home.steps.2.title": "Revisa tus opciones",
  "home.steps.2.body":
    "Compara vehículos uno junto al otro y mira cómo encaja cada uno con lo que quieres gastar.",
  "home.steps.3.title": "Arma tu oferta",
  "home.steps.3.body":
    "Dinos tu presupuesto y tu enganche. Te mostramos los caminos que encajan — y también los que no.",
  "home.steps.4.title": "Avancemos",
  "home.steps.4.body":
    "Cuando los números y el auto estén bien, nosotros nos encargamos del papeleo y tú te vas manejando.",
  "home.steps.cta": "Empezar mi búsqueda",
  "home.steps.note": "Sin cuenta, sin formularios y sin precios escondidos detrás de una llamada.",

  // ---- Homepage: buying options ------------------------------------------
  "home.options.eyebrow": "Opciones de compra",
  "home.options.title": "Paga como te acomode",
  "home.options.subtitle":
    "Aquí hay más de una forma de comprar un auto, y elegir una no te amarra. Revisamos las opciones con tus números sobre la mesa.",
  "home.options.cash.title": "Pago de contado",
  "home.options.cash.body": "El camino más simple. Acordamos el precio, firmamos el papeleo y te llevas las llaves.",
  "home.options.cash.point1": "Precio acordado por escrito",
  "home.options.cash.point2": "Sin trámite de financiamiento",
  "home.options.cash.point3": "Entrega más rápida",
  "home.options.finance.title": "Financiamiento tradicional",
  "home.options.finance.body":
    "Te acompañamos con la solicitud al banco o financiera y te ayudamos a reunir lo necesario, para que no lo armes solo.",
  "home.options.finance.point1": "Te guiamos en la solicitud",
  "home.options.finance.point2": "Sujeto a revisión del financiador",
  "home.options.finance.point3": "Las condiciones las define el financiador",
  "home.options.guided.title": "Estructura de compra guiada",
  "home.options.guided.body":
    "Trae un presupuesto y el pago mensual que buscas. Te mostramos los plazos que más se acercan y dónde está exactamente la decisión.",
  "home.options.guided.point1": "Escenarios de pago y plazo",
  "home.options.guided.point2": "Son estimados, no aprobaciones",
  "home.options.guided.point3": "Ajusta y compara antes de decidir",
  "home.options.flexible.title": "Formas flexibles de tener el auto",
  "home.options.flexible.body":
    "Según el vehículo y tu situación, puede haber planes tipo arrendamiento o de más largo plazo. Pregúntanos y te decimos con honestidad qué aplica.",
  "home.options.flexible.point1": "Depende del vehículo",
  "home.options.flexible.point2": "Te lo explicamos antes de firmar",
  "home.options.flexible.point3": "Sin obligación de continuar",
  "home.options.disclaimerLabel": "Sobre el financiamiento:",
  "home.options.disclaimer":
    "cualquier pago, plazo o tasa que veas en este sitio es solo un estimado para planear. No es una oferta de crédito, no es una decisión de crédito y no garantiza una aprobación. Las condiciones finales las define el financiador y dependen de tu solicitud.",

  // ---- Homepage: trust ----------------------------------------------------
  "home.trust.eyebrow": "Por qué Nexo Auto",
  "home.trust.title": "La confianza se construye con cómo trabajamos, no con lo que prometemos",
  "home.trust.subtitle":
    "Somos una operación pequeña, así que competimos con claridad y no con volumen. Esto es lo que podemos sostener hoy.",
  "home.trust.process.title": "Un proceso que puedes seguir",
  "home.trust.process.body":
    "Cada paso se explica antes de que ocurra. Siempre sabes qué sigue y cuánto cuesta.",
  "home.trust.car.title": "El auto que tienes enfrente",
  "home.trust.car.body":
    "Las publicaciones reflejan vehículos que realmente tenemos, con los datos que realmente conocemos — sin relleno.",
  "home.trust.people.title": "Una persona, no un portal",
  "home.trust.people.body":
    "Ser digitales no significa ser inalcanzables. Llama, escribe o manda un correo y recibirás una respuesta directa.",
  "home.trust.pressure.title": "Decide sin presión",
  "home.trust.pressure.body":
    "Los números y las opciones son tuyos para revisarlos. No hay reloj corriendo ni obligación de comprar.",
  "home.trust.aboutTitle": "Sobre {name}",

  // ---- Homepage: final CTA ------------------------------------------------
  "home.final.eyebrow": "Siguiente paso",
  "home.final.titleWithStock": "Encuentra el auto y tómate tu tiempo",
  "home.final.titleEmpty": "Dinos qué estás buscando",
  "home.final.bodyWithStock":
    "Revisa lo que hay disponible y pregúntanos lo que quieras — el precio, el historial, el financiamiento o si el auto te sirve para tu semana.",
  "home.final.bodyEmpty":
    "Ahora hay poco inventario, y preferimos encontrarte el vehículo correcto que empujarte el equivocado. Mándanos tu presupuesto y para qué necesitas el auto.",
  "home.final.browse": "Ver inventario",
  "home.final.call": "Llama al {phone}",
  "home.final.email": "Escribe a {name}",

  // ---- Vehicle card -------------------------------------------------------
  "card.photosSoon": "Fotos muy pronto",
  "card.askingPrice": "Precio",
  "card.explore": "Ver más",
  "card.viewAction": "Ver {vehicle}, número de stock {stock}, {price}",
  "card.photoAlt": "Foto de {vehicle}",

  // ---- Inventory index ----------------------------------------------------
  "inventory.breadcrumbHome": "Inicio",
  "inventory.breadcrumbCurrent": "Inventario",
  "inventory.title": "Inventario de vehículos",
  "inventory.intro":
    "Todo lo publicado por {name}, con el precio a la vista. Abre cualquier vehículo para ver fotos, especificaciones y opciones.",
  "inventory.searchLabel": "Buscar en el inventario por marca, modelo, VIN o número de stock",
  "inventory.searchPlaceholder": "Marca, modelo, VIN…",
  "inventory.searchAction": "Buscar",
  "inventory.resultsMatching": "Resultados para {query}",
  "inventory.resultsCountOne": "Mostrando {count} vehículo publicado",
  "inventory.resultsCountOther": "Mostrando {count} vehículos publicados",
  "inventory.empty.searchTitle": "Ningún vehículo coincide con {query}",
  "inventory.empty.title": "No hay vehículos publicados ahora",
  "inventory.empty.searchBody":
    "Prueba con otra marca, modelo o número de stock — o borra la búsqueda para ver todo lo publicado.",
  "inventory.empty.body":
    "Los nuevos vehículos aparecen aquí cuando están listos para la venta. Nada se publica hasta que está realmente disponible.",
  "inventory.empty.clearSearch": "Borrar búsqueda",
  "inventory.empty.home": "Volver al inicio",
  "inventory.empty.askAboutUpcoming": "Preguntar por los próximos autos",
  "inventory.paginationLabel": "Páginas del inventario",
  "inventory.previous": "Anterior",
  "inventory.next": "Siguiente",
  "inventory.page": "Página {page}",

  // ---- Vehicle detail -----------------------------------------------------
  "vehicle.notFoundTitle": "Vehículo no encontrado",
  "vehicle.statusAvailable": "Disponible",
  "vehicle.statusReserved": "Reservado",
  "vehicle.askingPrice": "Precio",
  "vehicle.priceNote": "Más impuestos, título y registro cuando apliquen.",
  "vehicle.about": "Sobre este vehículo",
  "vehicle.features": "Equipamiento y características",
  "vehicle.interestedTitle": "¿Te interesa este vehículo?",
  "vehicle.interestedBody":
    "Pregúntanos si sigue disponible, agenda una visita o revisemos los números juntos. Sin ningún compromiso.",
  "vehicle.call": "Llama al {phone}",
  "vehicle.emailAction": "Escribir sobre este vehículo",
  "vehicle.noContact": "Los datos de contacto de la agencia todavía no están configurados.",
  "vehicle.optionsLink": "Ver opciones de contado, financiamiento y planes flexibles",
  "vehicle.financeNote":
    "Las cifras de pago y plazo son solo estimados — no son una oferta, ni una decisión de crédito, ni una garantía de aprobación.",
  "vehicle.specs": "Especificaciones",
  "vehicle.backToInventory": "Volver a todo el inventario de {name}",
  "vehicle.mailSubject": "Consulta sobre {vehicle} (Stock #{stock})",
  "vehicle.srSummary": "{vehicle}, precio {price}",

  // ---- Specifications labels ---------------------------------------------
  "spec.mileage": "Millaje",
  "spec.exteriorColor": "Color exterior",
  "spec.interiorColor": "Color interior",
  "spec.transmission": "Transmisión",
  "spec.drivetrain": "Tracción",
  "spec.engine": "Motor",
  "spec.fuelType": "Combustible",
  "spec.bodyType": "Tipo de carrocería",
  "spec.titleStatus": "Estado del título",
  "spec.location": "Ubicación",
  "spec.notRecorded": "Sin registrar",
  "spec.miles": "{count} millas",
  "spec.stockNumber": "Stock #{stock}",
  "spec.vin": "VIN {vin}",

  // ---- Gallery ------------------------------------------------------------
  "gallery.placeholder": "Foto no disponible",
  "gallery.previous": "Foto anterior",
  "gallery.next": "Foto siguiente",
  "gallery.counter": "{current} / {total}",
  "gallery.thumbnail": "Foto {index} de {total}",

  // ---- Status badges ------------------------------------------------------
  "status.available": "DISPONIBLE",
  "status.reserved": "RESERVADO",
  "status.demo": "DEMO",

  // ---- Footer -------------------------------------------------------------
  "footer.explore": "Explora",
  "footer.browseInventory": "Ver inventario",
  "footer.howItWorks": "Cómo funciona",
  "footer.buyingOptions": "Opciones de compra",
  "footer.whyNexo": "Por qué Nexo Auto",
  "footer.talkToUs": "Hablemos",
  "footer.noContact": "Los datos de contacto aparecerán aquí cuando se configuren en la agencia.",
  "footer.financeNote": "Las cifras de financiamiento en las publicaciones son estimados, nunca aprobaciones.",
  "footer.rights": "© {year} {name}. Todos los derechos reservados.",
  "footer.taglineFallback":
    "Una selección cuidada de autos usados con precios claros y un camino directo desde que miras hasta que manejas.",

  // ---- Customer-visible failure states -----------------------------------
  "error.genericTitle": "Algo salió mal",
  "error.genericBody": "Inténtalo de nuevo. Si sigue pasando, llámanos o escríbenos y te ayudamos directamente.",
} as const;
