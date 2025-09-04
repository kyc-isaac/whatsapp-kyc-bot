// Módulo de Menús Interactivos para WhatsApp Business API
// Compatible con Twilio WhatsApp API 2025

/**
 * Menú Principal con Quick Reply Buttons
 * Límite: 3 botones, 20 caracteres cada uno
 */
function getMainMenuInteractive(userName, companyName) {
  return {
    type: "interactive",
    body: {
      text: `¡Hola *${userName}*! 👋\n\nBienvenido al Sistema *KYC LISTAS*\n🏢 _${companyName}_\n\n¿Cómo puedo ayudarte hoy?`
    },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: "search_kyc",
            title: "🔎 Buscar en Listas"
          }
        },
        {
          type: "reply", 
          reply: {
            id: "recent_searches",
            title: "📋 Búsquedas Recientes"
          }
        },
        {
          type: "reply",
          reply: {
            id: "help_menu",
            title: "ℹ️ Ayuda y Soporte"
          }
        }
      ]
    },
    header: {
      type: "text",
      text: "KYC SYSTEMS"
    },
    footer: {
      text: "Responde con el número de opción"
    }
  };
}

/**
 * Menú de Tipo de Búsqueda con List Message
 * Permite hasta 10 opciones en un menú desplegable
 */
function getSearchTypeList() {
  return {
    type: "interactive",
    header: {
      type: "text",
      text: "🔍 Tipo de Búsqueda KYC"
    },
    body: {
      text: "Selecciona el tipo de búsqueda que deseas realizar.\n\n*Principales listas disponibles:*\n• PEP's (Personas Expuestas Políticamente)\n• SAT 69-B (Servicio de Administración Tributaria)\n• LPB (Lista de Personas Bloqueadas)\n• OFAC (Office of Foreign Assets Control)\n• ONU (Organización de las Naciones Unidas)\n• INTERPOL (Organización Internacional de Policía)\n• FBI (Federal Bureau of Investigation)\n_Y más listas de compliance..._"
    },
    footer: {
      text: "Búsqueda en múltiples listas simultáneamente"
    },
    action: {
      button: "Ver Opciones",
      sections: [
        {
          title: "Tipo de Entidad",
          rows: [
            {
              id: "person_search",
              title: "👤 Persona Física",
              description: "Búsqueda por nombre completo"
            },
            {
              id: "company_search",
              title: "🏢 Empresa",
              description: "Búsqueda por razón social"
            }
          ]
        },
        {
          title: "Búsquedas Especiales",
          rows: [
            {
              id: "batch_search",
              title: "📊 Búsqueda Masiva",
              description: "Hasta 10 registros"
            },
            {
              id: "advanced_search",
              title: "⚙️ Búsqueda Avanzada",
              description: "Con parámetros específicos"
            }
          ]
        },
        {
          title: "Reportes",
          rows: [
            {
              id: "generate_report",
              title: "📄 Generar Reporte",
              description: "PDF con resultados"
            },
            {
              id: "history_report",
              title: "📈 Historial",
              description: "Últimas 30 búsquedas"
            }
          ]
        }
      ]
    }
  };
}

/**
 * Confirmación con Quick Reply Buttons
 */
function getConfirmationButtons(searchData) {
  const searchSummary = searchData.tipo === 'persona' 
    ? `*Nombre:* ${searchData.nombre}\n*Apellido:* ${searchData.apellidoPaterno} ${searchData.apellidoMaterno || ''}`
    : `*Empresa:* ${searchData.nombre}`;

  return {
    type: "interactive",
    header: {
      type: "text",
      text: "✅ Confirmar Búsqueda"
    },
    body: {
      text: `Por favor confirma los datos:\n\n${searchSummary}\n\n*Listas a consultar:*\n• PEP's, SAT 69-B, LPB\n• OFAC, ONU, INTERPOL, FBI\n• Y más listas de compliance...\n\n_Porcentaje de coincidencia: 98% (recomendado)_`
    },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: "confirm_search",
            title: "✅ Confirmar"
          }
        },
        {
          type: "reply",
          reply: {
            id: "modify_search",
            title: "✏️ Modificar"
          }
        },
        {
          type: "reply",
          reply: {
            id: "cancel_search",
            title: "❌ Cancelar"
          }
        }
      ]
    },
    footer: {
      text: "La búsqueda tomará aproximadamente 5 segundos"
    }
  };
}

/**
 * Resultados con Call-to-Action Buttons
 */
function getResultsWithActions(results, pdfUrl) {
  const hasMatches = results.coincidences > 0;
  const matchEmoji = hasMatches ? "⚠️" : "✅";
  const matchText = hasMatches 
    ? `Se encontraron *${results.coincidences} coincidencias*` 
    : "No se encontraron coincidencias";

  return {
    type: "interactive",
    header: {
      type: "text",
      text: `${matchEmoji} Resultados de Búsqueda`
    },
    body: {
      text: `${matchText}\n\n*Resumen:*\n${results.summary}\n\n*Listas consultadas:* 6/6\n*Tiempo de búsqueda:* ${results.searchTime}ms\n*Fecha:* ${new Date().toLocaleString()}`
    },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: "download_pdf",
            title: "📄 Descargar PDF"
          }
        },
        {
          type: "reply",
          reply: {
            id: "new_search",
            title: "🔎 Nueva Búsqueda"
          }
        },
        {
          type: "reply",
          reply: {
            id: "share_results",
            title: "📤 Compartir"
          }
        }
      ]
    },
    footer: {
      text: "Reporte disponible por 24 horas"
    }
  };
}

/**
 * Menú de Ayuda Mejorado
 */
function getHelpMenu() {
  return {
    type: "interactive",
    header: {
      type: "text",
      text: "ℹ️ Centro de Ayuda"
    },
    body: {
      text: "*¿En qué podemos ayudarte?*\n\nSelecciona una opción del menú para obtener asistencia inmediata."
    },
    action: {
      button: "Ver Opciones",
      sections: [
        {
          title: "Preguntas Frecuentes",
          rows: [
            {
              id: "faq_lists",
              title: "📋 Sobre las Listas",
              description: "Información de cada lista"
            },
            {
              id: "faq_search",
              title: "🔍 Cómo Buscar",
              description: "Guía paso a paso"
            },
            {
              id: "faq_results",
              title: "📊 Interpretar Resultados",
              description: "Entender coincidencias"
            }
          ]
        },
        {
          title: "Soporte Técnico",
          rows: [
            {
              id: "contact_support",
              title: "💬 Contactar Soporte",
              description: "Chat con agente"
            },
            {
              id: "report_issue",
              title: "🐛 Reportar Problema",
              description: "Informar un error"
            }
          ]
        },
        {
          title: "Información",
          rows: [
            {
              id: "about_system",
              title: "ℹ️ Acerca del Sistema",
              description: "Versión y características"
            },
            {
              id: "privacy_policy",
              title: "🔐 Privacidad",
              description: "Política de datos"
            }
          ]
        }
      ]
    },
    footer: {
      text: "Soporte disponible 24/7"
    }
  };
}

/**
 * Estado de Procesamiento con formato mejorado
 */
function getProcessingMessage() {
  return {
    type: "text",
    text: `🔄 *Procesando búsqueda...*\n\n⏳ _Consultando bases de datos_\n\n*Estado:*\n☑️ OFAC - Completado\n☑️ DEA - Completado\n☑️ SAT - Completado\n⏳ PEP - En proceso...\n⏳ FBI - En proceso...\n⏳ LPB - En proceso...\n\n_Por favor espera un momento..._`
  };
}

/**
 * Mensaje de Error Amigable
 */
function getErrorMessage(errorType = 'generic') {
  const errorMessages = {
    'timeout': '⏱️ La búsqueda tardó más de lo esperado. Por favor intenta nuevamente.',
    'api_error': '⚠️ Servicio temporalmente no disponible. Intenta en unos minutos.',
    'invalid_input': '❌ Los datos ingresados no son válidos. Por favor verifica e intenta nuevamente.',
    'generic': '😔 Algo salió mal. Nuestro equipo ha sido notificado.'
  };

  return {
    type: "interactive",
    header: {
      type: "text",
      text: "⚠️ Ups, ocurrió un problema"
    },
    body: {
      text: errorMessages[errorType] || errorMessages.generic
    },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: "retry",
            title: "🔄 Reintentar"
          }
        },
        {
          type: "reply",
          reply: {
            id: "main_menu",
            title: "🏠 Menú Principal"
          }
        },
        {
          type: "reply",
          reply: {
            id: "contact_support",
            title: "💬 Contactar Soporte"
          }
        }
      ]
    }
  };
}

/**
 * Notificación de Sesión Expirada
 */
function getSessionExpiredMessage() {
  return {
    type: "interactive",
    header: {
      type: "text",
      text: "⏰ Sesión Expirada"
    },
    body: {
      text: "Tu sesión ha expirado por inactividad.\n\n*Para continuar:*\nSelecciona una opción del menú o escribe *'Hola'* para iniciar una nueva sesión."
    },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: "start_new",
            title: "🔄 Nueva Sesión"
          }
        }
      ]
    },
    footer: {
      text: "Las sesiones expiran después de 6 horas"
    }
  };
}

module.exports = {
  getMainMenuInteractive,
  getSearchTypeList,
  getConfirmationButtons,
  getResultsWithActions,
  getHelpMenu,
  getProcessingMessage,
  getErrorMessage,
  getSessionExpiredMessage
};