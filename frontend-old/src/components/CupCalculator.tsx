import { useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'

type Inputs = {
    underBustRelaxed: string
    underBustExhale: string
    bustRelaxed: string
    bustBend45: string
    bustBend90: string
}

type Result = {
    isValid: boolean
    underBust: number | null
    cupDifference: number | null
    cupSize: string | null
    bandSize: number | null
    fullSize: string | null
    message: string
}

const CUP_TABLE = [
    { threshold: 5, size: 'AA以下', message: '小妹妹你还不需要穿内衣哦' },
    { threshold: 7.5, size: 'AA', message: 'AA，买少女小背心去吧' },
    { threshold: 10, size: 'A', message: '' },
    { threshold: 12.5, size: 'B', message: '' },
    { threshold: 15, size: 'C', message: '' },
    { threshold: 17.5, size: 'D', message: '' },
    { threshold: 20, size: 'E', message: '' },
    { threshold: Number.POSITIVE_INFINITY, size: 'E+', message: '你胸大你说了算（罩杯超出预设）' },
]

const toNumber = (v: string) => {
    const n = Number.parseFloat(v)
    return Number.isNaN(n) ? null : n
}

const calcCup = (inputs: Inputs): Result => {
    const underBustRelaxed = toNumber(inputs.underBustRelaxed)
    const underBustExhale = toNumber(inputs.underBustExhale)
    const bustRelaxed = toNumber(inputs.bustRelaxed)
    const bustBend45 = toNumber(inputs.bustBend45)
    const bustBend90 = toNumber(inputs.bustBend90)

    if (
        underBustRelaxed == null ||
        underBustExhale == null ||
        bustRelaxed == null ||
        bustBend45 == null ||
        bustBend90 == null
    ) {
        return {
            isValid: false,
            underBust: null,
            cupDifference: null,
            cupSize: null,
            bandSize: null,
            fullSize: null,
            message: '请完成所有测量步骤',
        }
    }

    if (
        underBustRelaxed <= 0 ||
        underBustExhale <= 0 ||
        bustRelaxed <= 0 ||
        bustBend45 <= 0 ||
        bustBend90 <= 0
    ) {
        return {
            isValid: false,
            underBust: null,
            cupDifference: null,
            cupSize: null,
            bandSize: null,
            fullSize: null,
            message: '数值错误，请检查输入的数据',
        }
    }

    const underBust = (underBustRelaxed + underBustExhale) / 2
    const bustAvg = (bustRelaxed + bustBend45 + bustBend90) / 3
    const cupDiff = bustAvg - underBust

    if (cupDiff < 0) {
        return {
            isValid: false,
            underBust,
            cupDifference: cupDiff,
            cupSize: null,
            bandSize: null,
            fullSize: null,
            message: '请检查测量数据',
        }
    }

    const hit = CUP_TABLE.find((x) => cupDiff <= x.threshold) ?? CUP_TABLE[CUP_TABLE.length - 1]
    const bandSize = 5 * Math.ceil(underBust / 5)
    const fullSize = `${bandSize}${hit.size}`

    return {
        isValid: true,
        underBust,
        cupDifference: cupDiff,
        cupSize: hit.size,
        bandSize,
        fullSize,
        message: hit.message || `您的内衣尺寸是：${fullSize}`,
    }
}

export default function CupCalculator() {
    const [inputs, setInputs] = useState<Inputs>({
        underBustRelaxed: '',
        underBustExhale: '',
        bustRelaxed: '',
        bustBend45: '',
        bustBend90: '',
    })
    const [result, setResult] = useState<Result | null>(null)

    const isComplete = useMemo(() => Object.values(inputs).every((v) => v.trim() !== ''), [inputs])

    return (
        <Card sx={{ maxWidth: 720, mx: 'auto' }}>
            <CardContent>
                <Typography variant="h5" fontWeight={800}>
                    罩杯计算器
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.7, mt: 1 }}>
                    说明：输入 5 个测量值（单位：cm），计算结果仅供参考。
                </Typography>

                <Stack spacing={2} sx={{ mt: 2 }}>
                    <TextField
                        label="胸下围（放松）cm"
                        value={inputs.underBustRelaxed}
                        onChange={(e) => setInputs((s) => ({ ...s, underBustRelaxed: e.target.value }))}
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        fullWidth
                    />
                    <TextField
                        label="胸下围（呼气）cm"
                        value={inputs.underBustExhale}
                        onChange={(e) => setInputs((s) => ({ ...s, underBustExhale: e.target.value }))}
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        fullWidth
                    />
                    <TextField
                        label="胸围（放松）cm"
                        value={inputs.bustRelaxed}
                        onChange={(e) => setInputs((s) => ({ ...s, bustRelaxed: e.target.value }))}
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        fullWidth
                    />
                    <TextField
                        label="胸围（45°）cm"
                        value={inputs.bustBend45}
                        onChange={(e) => setInputs((s) => ({ ...s, bustBend45: e.target.value }))}
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        fullWidth
                    />
                    <TextField
                        label="胸围（90°）cm"
                        value={inputs.bustBend90}
                        onChange={(e) => setInputs((s) => ({ ...s, bustBend90: e.target.value }))}
                        type="number"
                        inputProps={{ min: 0, step: 0.1 }}
                        fullWidth
                    />

                    <Button
                        variant="contained"
                        disabled={!isComplete}
                        onClick={() => setResult(calcCup(inputs))}
                    >
                        计算
                    </Button>
                </Stack>

                {result ? (
                    <Box sx={{ mt: 2 }}>
                        <Alert severity={result.isValid ? 'success' : 'warning'}>
                            {result.message}
                        </Alert>
                        {result.isValid ? (
                            <Typography variant="body2" sx={{ mt: 1, opacity: 0.8 }}>
                                胸下围：{result.underBust?.toFixed(1)} cm ｜ 罩杯差值：
                                {result.cupDifference?.toFixed(1)} cm ｜ 罩杯：{result.cupSize}
                            </Typography>
                        ) : null}
                    </Box>
                ) : null}
            </CardContent>
        </Card>
    )
}
