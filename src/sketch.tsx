import { MotorModel, RigidBodyType } from '@dimforge/rapier3d-compat'
import { KeyboardControls, useKeyboardControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import {
    CuboidCollider,
    CylinderCollider,
    Physics,
    type RapierRigidBody,
    RigidBody,
    useFixedJoint,
    useRevoluteJoint,
} from '@react-three/rapier'
import React, { type RefObject, createRef, useCallback, useEffect, useRef, useState } from 'react'
import { type Quaternion, Vector3, type Vector3Tuple, type Vector4Tuple } from 'three'
import { Instructions, usePageVisible } from './ui'
import { Canvas } from '@react-three/fiber'

const CONTROLS = {
    forward: 'forward',
    back: 'back',
    left: 'left',
    right: 'right',
    brake: 'brake',
}

const CONTROLS_MAP = [
    { name: CONTROLS.forward, keys: ['ArrowUp', 'w', 'W'] },
    { name: CONTROLS.back, keys: ['ArrowDown', 's', 'S'] },
    { name: CONTROLS.left, keys: ['ArrowLeft', 'a', 'A'] },
    { name: CONTROLS.right, keys: ['ArrowRight', 'd', 'D'] },
    { name: CONTROLS.brake, keys: ['Space'] },
]

const RAPIER_UPDATE_PRIORITY = -50
const AFTER_RAPIER_UPDATE = RAPIER_UPDATE_PRIORITY - 1

const AXLE_TO_CHASSIS_JOINT_STIFFNESS = 100
const AXLE_TO_CHASSIS_JOINT_DAMPING = 10

const DRIVEN_WHEEL_TARGET_VELOCITY = 1000
const DRIVEN_WHEEL_FACTOR = 10

const TURN_ANGLE = 0.6
const TIME_LIMIT_SECONDS = 30
const ROAD_WIDTH = 10

const CHECKPOINTS: Vector3Tuple[] = [
    [-18, 0, 0],
    [-38, 0, 0],
    [-54, 0, 5],
    [-64, 0, 16],
    [-61, 0, 29],
    [-50, 0, 37],
    [-30, 0, 40],
    [-8, 0, 40],
    [12, 0, 40],
]

const ROUTE_POINTS: Vector3Tuple[] = [[8, 0, 0], [0, 0, 0], ...CHECKPOINTS, [22, 0, 40]]

type FixedJointProps = {
    body: RefObject<RapierRigidBody>
    wheel: RefObject<RapierRigidBody>
    body1Anchor: Vector3Tuple
    body1LocalFrame: Vector4Tuple
    body2Anchor: Vector3Tuple
    body2LocalFrame: Vector4Tuple
}

const FixedJoint = ({ body, wheel, body1Anchor, body1LocalFrame, body2Anchor, body2LocalFrame }: FixedJointProps) => {
    useFixedJoint(body, wheel, [body1Anchor, body1LocalFrame, body2Anchor, body2LocalFrame])

    return null
}

type AxleJointProps = {
    body: RefObject<RapierRigidBody>
    wheel: RefObject<RapierRigidBody>
    bodyAnchor: Vector3Tuple
    wheelAnchor: Vector3Tuple
    rotationAxis: Vector3Tuple
    isDriven: boolean
}

const AxleJoint = ({ body, wheel, bodyAnchor, wheelAnchor, rotationAxis, isDriven }: AxleJointProps) => {
    const joint = useRevoluteJoint(body, wheel, [bodyAnchor, wheelAnchor, rotationAxis])

    const forwardPressed = useKeyboardControls((state) => state.forward)
    const backwardPressed = useKeyboardControls((state) => state.back)

    // Rapier joints and bodies are stable refs managed outside React's dependency graph.
    // biome-ignore lint/correctness/useExhaustiveDependencies: Rapier ref methods are intentionally read when control state changes.
    useEffect(() => {
        if (!isDriven) return

        let forward = 0
        if (forwardPressed) forward += 1
        if (backwardPressed) forward -= 1

        forward *= DRIVEN_WHEEL_TARGET_VELOCITY

        if (forward !== 0) {
            wheel.current?.wakeUp()
        }

        joint.current?.configureMotorModel(MotorModel.AccelerationBased)
        joint.current?.configureMotorVelocity(forward, DRIVEN_WHEEL_FACTOR)
    }, [forwardPressed, backwardPressed])

    return null
}

type SteeredJointProps = {
    body: RefObject<RapierRigidBody>
    wheel: RefObject<RapierRigidBody>
    bodyAnchor: Vector3Tuple
    wheelAnchor: Vector3Tuple
    rotationAxis: Vector3Tuple
}

const SteeredJoint = ({ body, wheel, bodyAnchor, wheelAnchor, rotationAxis }: SteeredJointProps) => {
    const joint = useRevoluteJoint(body, wheel, [bodyAnchor, wheelAnchor, rotationAxis])

    const left = useKeyboardControls((state) => state.left)
    const right = useKeyboardControls((state) => state.right)
    let targetPos = 0
    if (left) targetPos += TURN_ANGLE
    if (right) targetPos -= TURN_ANGLE

    // biome-ignore lint/correctness/useExhaustiveDependencies: Rapier ref methods are intentionally read when steering changes.
    useEffect(() => {
        joint.current?.configureMotorModel(MotorModel.ForceBased)
        joint.current?.configureMotorPosition(targetPos, AXLE_TO_CHASSIS_JOINT_STIFFNESS, AXLE_TO_CHASSIS_JOINT_DAMPING)
    }, [left, right])

    return null
}

type WheelInfo = {
    axlePosition: Vector3Tuple
    wheelPosition: Vector3Tuple
    isSteered: boolean
    side: 'left' | 'right'
    isDriven: boolean
}

const axleY = -0.6
const wheelY = -0.6
const wheels: WheelInfo[] = [
    {
        axlePosition: [-1.2, axleY, 0.7],
        wheelPosition: [-1.2, wheelY, 1],
        isSteered: true,
        side: 'left',
        isDriven: false,
    },
    {
        axlePosition: [-1.2, axleY, -0.7],
        wheelPosition: [-1.2, wheelY, -1],
        isSteered: true,
        side: 'right',
        isDriven: false,
    },
    {
        axlePosition: [1.2, axleY, 0.7],
        wheelPosition: [1.2, wheelY, 1],
        isSteered: false,
        side: 'left',
        isDriven: true,
    },
    {
        axlePosition: [1.2, axleY, -0.7],
        wheelPosition: [1.2, wheelY, -1],
        isSteered: false,
        side: 'right',
        isDriven: true,
    },
]

const vec3 = {
    add: (a: Vector3Tuple, b: Vector3Tuple) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Vector3Tuple,
}

type RevoluteJointVehicleProps = {
    position: Vector3Tuple
    onPositionChange: (position: Vector3) => void
    stopped: boolean
}

const RevoluteJointVehicle = ({ position, onPositionChange, stopped }: RevoluteJointVehicleProps) => {
    const camera = useThree((state) => state.camera)
    const currentCameraPosition = useRef(new Vector3(15, 15, 0))
    const currentCameraLookAt = useRef(new Vector3())

    const chassisRef = useRef<RapierRigidBody>(null!)

    const wheelRefs = useRef(wheels.map(() => createRef())) as RefObject<RefObject<RapierRigidBody>[]>
    const axleRefs = useRef(wheels.map(() => createRef())) as RefObject<RefObject<RapierRigidBody>[]>

    // biome-ignore lint/correctness/useExhaustiveDependencies: Vehicle body refs are stable for the mounted vehicle.
    useEffect(() => {
        if (!stopped) return

        const bodies = [
            chassisRef.current,
            ...wheelRefs.current.map((ref) => ref.current),
            ...axleRefs.current.map((ref) => ref.current),
        ].filter((body): body is RapierRigidBody => body != null)

        for (const body of bodies) {
            body.setLinvel({ x: 0, y: 0, z: 0 }, false)
            body.setAngvel({ x: 0, y: 0, z: 0 }, false)
            body.setBodyType(RigidBodyType.Fixed, false)
        }
    }, [stopped])

    useFrame((_, delta) => {
        if (!chassisRef.current) {
            return
        }

        const chassisPosition = chassisRef.current.translation() as Vector3
        onPositionChange(chassisPosition)

        const t = 1.0 - 0.01 ** delta

        const idealOffset = new Vector3(10, 5, 0)
        idealOffset.applyQuaternion(chassisRef.current.rotation() as Quaternion)
        idealOffset.add(chassisPosition)
        if (idealOffset.y < 0) {
            idealOffset.y = 0
        }

        const idealLookAt = new Vector3(0, 1, 0)
        idealLookAt.applyQuaternion(chassisRef.current.rotation() as Quaternion)
        idealLookAt.add(chassisPosition)

        currentCameraPosition.current.lerp(idealOffset, t)
        currentCameraLookAt.current.lerp(idealLookAt, t)

        camera.position.copy(currentCameraPosition.current)
        camera.lookAt(currentCameraLookAt.current)
    }, AFTER_RAPIER_UPDATE)

    return (
        <>
            <group>
                {/* chassis */}
                <RigidBody ref={chassisRef} position={position} colliders="cuboid" mass={5}>
                    <mesh castShadow receiveShadow>
                        <boxGeometry args={[3.5, 0.5, 1.5]} />
                        <meshStandardMaterial color="#333" />
                    </mesh>
                </RigidBody>

                {/* wheels */}
                {wheels.map((wheel, i) => (
                    <React.Fragment key={`${wheel.side}-${wheel.axlePosition.join('-')}`}>
                        {/* axle */}
                        <RigidBody
                            ref={axleRefs.current[i]}
                            position={vec3.add(wheel.axlePosition, position)}
                            colliders="cuboid"
                            mass={0.2}
                        >
                            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
                                <boxGeometry args={[0.3, 0.3, 0.3]} />
                                <meshStandardMaterial color="#999" />
                            </mesh>
                        </RigidBody>

                        {/* wheel */}
                        <RigidBody
                            ref={wheelRefs.current[i]}
                            position={vec3.add(wheel.wheelPosition, position)}
                            colliders={false}
                            mass={0.2}
                            restitution={0}
                        >
                            <mesh rotation-x={-Math.PI / 2} castShadow receiveShadow>
                                <cylinderGeometry args={[0.25, 0.25, 0.24, 32]} />
                                <meshStandardMaterial color="#666" />
                            </mesh>

                            <mesh rotation-x={-Math.PI / 2}>
                                <cylinderGeometry args={[0.251, 0.251, 0.241, 16]} />
                                <meshStandardMaterial color="#000" wireframe />
                            </mesh>

                            <CylinderCollider mass={0.5} friction={1.5} args={[0.125, 0.25]} rotation={[-Math.PI / 2, 0, 0]} />
                        </RigidBody>

                        {/* axle to chassis joint */}
                        {!wheel.isSteered ? (
                            <FixedJoint
                                body={chassisRef}
                                wheel={axleRefs.current[i]}
                                body1Anchor={wheel.axlePosition}
                                body1LocalFrame={[0, 0, 0, 1]}
                                body2Anchor={[0, 0, 0]}
                                body2LocalFrame={[0, 0, 0, 1]}
                            />
                        ) : (
                            <SteeredJoint
                                body={chassisRef}
                                wheel={axleRefs.current[i]}
                                bodyAnchor={wheel.axlePosition}
                                wheelAnchor={[0, 0, 0]}
                                rotationAxis={[0, 1, 0]}
                            />
                        )}

                        {/* wheel to axle joint */}
                        <AxleJoint
                            body={axleRefs.current[i]}
                            wheel={wheelRefs.current[i]}
                            bodyAnchor={[0, 0, wheel.side === 'left' ? 0.35 : -0.35]}
                            wheelAnchor={[0, 0, 0]}
                            rotationAxis={[0, 0, 1]}
                            isDriven={wheel.isDriven}
                        />
                    </React.Fragment>
                ))}
            </group>
        </>
    )
}

type SceneProps = {
    activeCheckpoint: number
}

const CheckpointGate = ({ position, active, passed }: { position: Vector3Tuple; active: boolean; passed: boolean }) => {
    const color = passed ? '#42d392' : active ? '#ffd43b' : '#657080'

    return (
        <group position={[position[0], 2.5, position[2]]}>
            <mesh rotation={[0, Math.PI / 2, 0]}>
                <torusGeometry args={[3.5, active ? 0.28 : 0.18, 12, 48]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 2 : 0.35} />
            </mesh>
            {active ? <pointLight color={color} intensity={35} distance={10} /> : null}
        </group>
    )
}

const HighwaySegment = ({ from, to }: { from: Vector3Tuple; to: Vector3Tuple }) => {
    const dx = to[0] - from[0]
    const dz = to[2] - from[2]
    const length = Math.hypot(dx, dz)
    const rotationY = -Math.atan2(dz, dx)
    const dashCount = Math.max(1, Math.floor(length / 3))

    return (
        <RigidBody
            type="fixed"
            colliders={false}
            position={[(from[0] + to[0]) / 2, -0.86, (from[2] + to[2]) / 2]}
            rotation={[0, rotationY, 0]}
        >
            <CuboidCollider args={[length / 2 + 0.25, 0.55, 0.16]} position={[0, 0.55, ROAD_WIDTH / 2 + 0.15]} />
            <CuboidCollider args={[length / 2 + 0.25, 0.55, 0.16]} position={[0, 0.55, -ROAD_WIDTH / 2 - 0.15]} />

            <mesh receiveShadow>
                <boxGeometry args={[length + 0.5, 0.16, ROAD_WIDTH]} />
                <meshStandardMaterial color="#282c32" roughness={0.92} />
            </mesh>

            {Array.from({ length: dashCount }).map((_, index) => {
                const dashPosition = -length / 2 + ((index + 0.5) * length) / dashCount

                return (
                <mesh key={dashPosition} position={[dashPosition, 0.1, 0]}>
                    <boxGeometry args={[1.5, 0.025, 0.12]} />
                    <meshStandardMaterial color="#f5f1cf" />
                </mesh>
                )
            })}

            {[-1, 1].map((side) => (
                <React.Fragment key={side}>
                    <mesh position={[0, 0.55, side * (ROAD_WIDTH / 2 + 0.15)]} castShadow>
                        <boxGeometry args={[length + 0.5, 1.1, 0.32]} />
                        <meshStandardMaterial color="#d7dbe0" metalness={0.55} roughness={0.4} />
                    </mesh>
                    <mesh position={[0, 0.1, side * (ROAD_WIDTH / 2 - 0.3)]}>
                        <boxGeometry args={[length + 0.5, 0.025, 0.13]} />
                        <meshStandardMaterial color="#f7f7f2" />
                    </mesh>
                </React.Fragment>
            ))}
        </RigidBody>
    )
}

const HighwayJunction = ({ position }: { position: Vector3Tuple }) => (
    <RigidBody type="fixed" colliders={false} position={[position[0], -0.86, position[2]]}>
        <mesh receiveShadow>
            <cylinderGeometry args={[ROAD_WIDTH / 2, ROAD_WIDTH / 2, 0.16, 64]} />
            <meshStandardMaterial color="#282c32" roughness={0.92} />
        </mesh>
    </RigidBody>
)

const HighwayBarrierJunction = ({
    previous,
    position,
    next,
}: {
    previous: Vector3Tuple
    position: Vector3Tuple
    next: Vector3Tuple
}) => {
    const barrierOffset = ROAD_WIDTH / 2 + 0.15
    const previousLength = Math.hypot(position[0] - previous[0], position[2] - previous[2])
    const nextLength = Math.hypot(next[0] - position[0], next[2] - position[2])
    const previousNormal = [-(position[2] - previous[2]) / previousLength, (position[0] - previous[0]) / previousLength]
    const nextNormal = [-(next[2] - position[2]) / nextLength, (next[0] - position[0]) / nextLength]

    return (
        <>
            {[-1, 1].map((side) => {
                const fromX = position[0] + previousNormal[0] * barrierOffset * side
                const fromZ = position[2] + previousNormal[1] * barrierOffset * side
                const toX = position[0] + nextNormal[0] * barrierOffset * side
                const toZ = position[2] + nextNormal[1] * barrierOffset * side
                const dx = toX - fromX
                const dz = toZ - fromZ
                const length = Math.hypot(dx, dz)

                return (
                    <RigidBody
                        key={side}
                        type="fixed"
                        colliders={false}
                        position={[(fromX + toX) / 2, -0.31, (fromZ + toZ) / 2]}
                        rotation={[0, -Math.atan2(dz, dx), 0]}
                    >
                        <CuboidCollider args={[length / 2 + 0.16, 0.55, 0.16]} />
                        <mesh castShadow>
                            <boxGeometry args={[length + 0.32, 1.1, 0.32]} />
                            <meshStandardMaterial color="#d7dbe0" metalness={0.55} roughness={0.4} />
                        </mesh>
                    </RigidBody>
                )
            })}
        </>
    )
}

const Highway = () => (
    <>
        {ROUTE_POINTS.slice(0, -1).map((point, index) => (
            <HighwaySegment key={point.join('-')} from={point} to={ROUTE_POINTS[index + 1]} />
        ))}
        {ROUTE_POINTS.slice(1, -1).map((point, index) => (
            <React.Fragment key={`junction-${point.join('-')}`}>
                <HighwayJunction position={point} />
                <HighwayBarrierJunction
                    previous={ROUTE_POINTS[index]}
                    position={point}
                    next={ROUTE_POINTS[index + 2]}
                />
            </React.Fragment>
        ))}
    </>
)

const Scene = ({ activeCheckpoint }: SceneProps) => {
    return (
        <>
            <Highway />

            {CHECKPOINTS.map((position, index) => (
                <CheckpointGate
                    key={position.join('-')}
                    position={position}
                    active={index === activeCheckpoint}
                    passed={index < activeCheckpoint}
                />
            ))}

            {/* ground */}
            <RigidBody type="fixed" friction={2.5} position-y={-1.8}>
                <mesh receiveShadow>
                    <boxGeometry args={[150, 2, 150]} />
                    <meshStandardMaterial color="#ccc" />
                </mesh>
            </RigidBody>

            {/* lights */}
            <ambientLight intensity={2.5} />
            <pointLight
                intensity={500}
                decay={1.5}
                position={[-10, 30, 20]}
                castShadow
                shadow-camera-top={8}
                shadow-camera-right={8}
                shadow-camera-bottom={-8}
                shadow-camera-left={-8}
                shadow-mapSize-height={2048}
                shadow-mapSize-width={2048}
            />
        </>
    )
}

export function Sketch() {
    const visible = usePageVisible()
    const [runId, setRunId] = useState(0)
    const [activeCheckpoint, setActiveCheckpoint] = useState(0)
    const [remainingTime, setRemainingTime] = useState(TIME_LIMIT_SECONDS)
    const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing')
    const deadlineRef = useRef(Date.now() + TIME_LIMIT_SECONDS * 1000)

    const restart = useCallback(() => {
        deadlineRef.current = Date.now() + TIME_LIMIT_SECONDS * 1000
        setRunId((value) => value + 1)
        setActiveCheckpoint(0)
        setRemainingTime(TIME_LIMIT_SECONDS)
        setStatus('playing')
    }, [])

    useEffect(() => {
        if (status !== 'playing' || !visible) return

        const timer = window.setInterval(() => {
            const nextRemainingTime = Math.max(0, (deadlineRef.current - Date.now()) / 1000)
            setRemainingTime(nextRemainingTime)

            if (nextRemainingTime === 0) setStatus('lost')
        }, 100)

        return () => window.clearInterval(timer)
    }, [status, visible])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code !== 'KeyR' || event.repeat) return

            event.preventDefault()
            restart()
        }

        document.addEventListener('keydown', onKeyDown, { capture: true })
        return () => document.removeEventListener('keydown', onKeyDown, { capture: true })
    }, [restart])

    const onVehiclePositionChange = useCallback(
        (position: Vector3) => {
            if (status !== 'playing') return

            const checkpoint = CHECKPOINTS[activeCheckpoint]
            if (!checkpoint) return

            const dx = position.x - checkpoint[0]
            const dz = position.z - checkpoint[2]

            if (dx * dx + dz * dz > 16) return

            if (activeCheckpoint === CHECKPOINTS.length - 1) {
                setActiveCheckpoint(CHECKPOINTS.length)
                setStatus('won')
            } else {
                setActiveCheckpoint((value) => value + 1)
            }
        },
        [activeCheckpoint, status],
    )

    return (
        <>
            <Canvas camera={{ fov: 60, position: [30, 30, 0] }} shadows>
                <Physics
                    updatePriority={RAPIER_UPDATE_PRIORITY}
                    paused={!visible}
                    debug={false}
                    numSolverIterations={10}
                    numInternalPgsIterations={10}
                >
                    <KeyboardControls key={runId} map={CONTROLS_MAP}>
                        <RevoluteJointVehicle
                            position={[0, 1, 0]}
                            onPositionChange={onVehiclePositionChange}
                            stopped={status === 'won'}
                        />
                    </KeyboardControls>

                    <Scene activeCheckpoint={activeCheckpoint} />
                </Physics>
            </Canvas>

            <div
                style={{
                    position: 'fixed',
                    top: 20,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    gap: 24,
                    padding: '12px 20px',
                    borderRadius: 14,
                    background: 'rgba(10, 14, 20, 0.82)',
                    fontFamily: 'system-ui, sans-serif',
                    fontWeight: 700,
                    zIndex: 20,
                    backdropFilter: 'blur(10px)',
                }}
            >
                <span style={{ color: remainingTime <= 10 ? '#ff6b6b' : '#fff' }}>{remainingTime.toFixed(1)}초</span>
                <span>
                    체크포인트 {Math.min(activeCheckpoint + 1, CHECKPOINTS.length)} / {CHECKPOINTS.length}
                </span>
            </div>

            {status !== 'playing' ? (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        display: 'grid',
                        placeItems: 'center',
                        background: 'rgba(5, 8, 12, 0.65)',
                        zIndex: 30,
                    }}
                >
                    <div style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
                        <h1 style={{ margin: 0, fontSize: 56 }}>{status === 'won' ? '완주!' : '시간 초과'}</h1>
                        <p>{status === 'won' ? `${remainingTime.toFixed(1)}초를 남겼습니다.` : '다시 도전해 보세요.'}</p>
                        <button
                            type="button"
                            onClick={restart}
                            style={{ padding: '12px 24px', border: 0, borderRadius: 10, fontSize: 16, cursor: 'pointer' }}
                        >
                            다시 시작 (R)
                        </button>
                    </div>
                </div>
            ) : null}

            <Instructions>WASD 운전 · 노란 체크포인트를 순서대로 통과 · R 재시작</Instructions>
        </>
    )
}
