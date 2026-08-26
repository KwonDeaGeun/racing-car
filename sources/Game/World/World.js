import { Game } from '../Game.js'
import { Floor } from './Floor.js'
import { Areas } from './Areas/Areas.js'
import { VisualVehicle } from './VisualVehicle.js'
import { Confetti } from './Confetti.js'

export class World
{
    constructor()
    {
        this.game = Game.getInstance()
    }

    step(step)
    {
        if(step !== 1)
            return

        this.visualVehicle = new VisualVehicle(this.game.resources.vehicle.scene)
        this.floor = new Floor()
        this.setRaceRoad()
        this.confetti = new Confetti()
        this.areas = new Areas()
    }

    setRaceRoad()
    {
        this.raceRoad = this.game.resources.raceSceneryModel.scene.getObjectByName('refRoad')

        if(!this.raceRoad)
            return

        this.game.materials.updateObject(this.raceRoad)
        this.raceRoad.receiveShadow = true
        this.game.scene.add(this.raceRoad)
    }
}
