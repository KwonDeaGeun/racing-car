import * as THREE from 'three/webgpu'
import { Howl, Howler } from 'howler'
import { Game } from './Game.js'
import { remap, remapClamp, clamp } from './utilities/maths.js'
import gsap from 'gsap'
import { Events } from './Events.js'

export class Audio
{
    constructor()
    {
        this.game = Game.getInstance()

        this.initiated = false
        this.groups = new Map()
        this.events = new Events()

        this.setMute()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 14)
    }

    init()
    {
        this.initiated = true

        // Play all autoplays that didn't start because not initated
        this.groups.forEach((group, name) =>
        {
            for(const item of group.items)
            {
                if(item.autoplay && !item.playing)
                    item.play()
            }
        })
    }

    register(options = {})
    {
        // Group
        const groupName = options.group ?? 'all'
        let group = this.groups.get(groupName)

        if(!group)
        {
            group = {}
            group.items = []
            group.lastPlayedId = -1
            group.playRandomNext = (...parameters) =>
            {
                const delta = 1 + Math.floor(Math.random() * (group.items.length - 2))
                const id = (group.lastPlayedId + delta) % group.items.length

                const item = group.items[id]
                item.play(...parameters)
            }
            group.play = (...parameters) =>
            {
                const id = (group.lastPlayedId + 1) % group.items.length

                const item = group.items[id]
                item.play(...parameters)
            }
            this.groups.set(groupName, group)
        }

        const item = {}
        item.howl = new Howl({
            src: [ options.path ],
            pool: 2,
            autoplay: (this.initiated && options.autoplay) ?? false,
            loop: options.loop ?? false,
            volume: options.volume ?? 0.5,
            preload: options.preload ?? true,
            onloaderror: () =>
            {
                console.error(`Audio > Load error > ${options.path}`, options)
            },
            onend: () =>
            {
                item.playing = false
            }
        })
        item.positions = options.positions ?? null
        if(item.positions !== null && !(item.positions instanceof Array))
            item.positions = [ item.positions ]
        item.distanceFade = options.distanceFade ?? null
        item.rate = options.rate ?? 1
        item.volume = options.volume ?? 0.5
        item.antiSpam = options.antiSpam ?? 0.1
        item.lastPlay = -Infinity
        item.onPlaying = options.onPlaying ?? null
        item.onPlay = options.onPlay ?? null
        item.loaded = options.preload ?? true
        item.autoplay = options.autoplay ?? false
        item.playing = (this.initiated && options.autoplay) ?? false
        item.id = group.items.length

        item.play = (...parameters) =>
        {
            if(!this.initiated)
            {
                return
            }

            // Load
            if(!item.loaded)
            {
                item.loaded = true
                item.howl.load()
            }

            // Anti spam
            if(item.antiSpam)
            {
                if(this.game.ticker.elapsed - item.lastPlay < item.antiSpam)
                    return
            }

            // Play binding
            if(typeof item.onPlay === 'function')
                item.onPlay(item, ...parameters)
                
            // Play
            item.howl.play()

            // Save last play for anti spam
            item.lastPlay = this.game.ticker.elapsed
            item.playing = true

            // Save for group
            group.lastPlayedId = item.id
        }

        group.items.push(item)

        return item
    }

    setMute()
    {
        this.mute = {}

        this.mute.active = false

        this.mute.toggle = () =>
        {
            if(this.mute.active)
                this.mute.deactivate()
            else
                this.mute.activate()
        }

        this.mute.activate = () =>
        {
            if(this.mute.active)
                return
            
            Howler.mute(true)
            this.mute.active = true
            localStorage.setItem('soundToggle', '1')
            document.documentElement.classList.add('is-audio-muted')
            this.events.trigger('muteChange', [ true ])
        }

        this.mute.deactivate = () =>
        {
            if(!this.mute.active)
                return
            
            Howler.mute(false)
            this.mute.active = false
            localStorage.setItem('soundToggle', '0')
            document.documentElement.classList.remove('is-audio-muted')
            this.events.trigger('muteChange', [ false ])
        }

        // From local storage
        const soundToggleLocal = localStorage.getItem('soundToggle')
        if(soundToggleLocal !== null && soundToggleLocal === '1')
            this.mute.activate()

        // Inputs keyboard
        this.game.inputs.addActions([
            { name: 'mute', categories: [ 'intro', 'modal', 'menu', 'racing', 'cinematic', 'wandering' ], keys: [ 'Keyboard.l' ] },
        ])
        this.game.inputs.events.on('mute', (action) =>
        {
            if(action.active)
                this.mute.toggle()
        })

        // Tab focus / blur
        window.addEventListener('blur', () =>
        {
            Howler.mute(true)

            if(this.playlist?.current)
                this.playlist.current.sound.pause()
        })

        window.addEventListener('focus', () =>
        {
            if(!this.mute.active)
            {
                Howler.mute(false)

                if(this.playlist?.current)
                    this.playlist.current.sound.play()
            }
        })

    }

    update()
    {
        this.globalRate = this.game.time.scale / this.game.time.defaultScale
        this.groups.forEach((group) =>
        {
            for(const item of group.items)
            {
                // Apply tick binding
                if(typeof item.onPlaying === 'function')
                {
                    item.onPlaying(item)
                }

                // Positional and distance fade
                let distanceFadeMultiplier = 1
                if(item.positions && item.howl.playing())
                {
                    let closestDistance = Infinity
                    let closestPosition = null

                    for(const position of item.positions)
                    {
                        const distance = position.distanceTo(this.game.view.focusPoint.position)

                        if(distance < closestDistance)
                        {
                            closestDistance = distance
                            closestPosition = position
                        }
                    }

                    const cameraRelativePosition = closestPosition.clone()
                    cameraRelativePosition.applyMatrix4(this.game.view.camera.matrixWorldInverse)
                    cameraRelativePosition.normalize()
                    cameraRelativePosition.z *= 0.1

                    if(item.distanceFade)
                    {
                        distanceFadeMultiplier = remapClamp(closestDistance, 0, item.distanceFade, 1, 0)
                    }

                    if(distanceFadeMultiplier > 0)
                        item.howl.pos(cameraRelativePosition.x, cameraRelativePosition.y, cameraRelativePosition.z)
                }

                // Rate (apply global too)
                item.howl.rate(clamp(item.rate * this.globalRate, 0.5, 4))

                // Volume
                const volume = item.volume * distanceFadeMultiplier
                item.howl.volume(item.volume * distanceFadeMultiplier)

                item.howl.mute(volume < 0.01)
            }
        })
    }
}
