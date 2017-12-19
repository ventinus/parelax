import {
  parallax
} from './modules'

const main = () => {
  const modules = {
    parallax
  }

  const initModules = () => {
    for (let k in modules) {
      if (modules.hasOwnProperty(k)) {
        if (!modules[k].init) modules[k] = modules[k]()

        modules[k].init()
      }
    }
  }

  const init = () => {
    initModules()
  }

  return {
    init
  }
}

export default main
